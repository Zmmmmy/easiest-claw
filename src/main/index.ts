import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerAllIpcHandlers } from './ipc'
import { startRuntime, stopRuntime } from './gateway/runtime'
import { autoSpawnBundledOpenclaw, addGatewayLogListener, getGatewayLogBuffer } from './gateway/bundled-process'
import { extractOpenClawIfNeeded, getExtractState, confirmUpgrade, skipUpgrade } from './openclaw-init'
import { logger } from './lib/logger'
import { FIREWALL_RULE_NAME, APP_ID } from '@shared/branding'
import { initAppUpdater, registerAppUpdaterHandlers } from './app-updater'

// App icon（开发和生产均用同一份，electron-builder 打包时也从 package.json 读取）
const APP_ICON = join(app.getAppPath(), 'resources', 'icon.ico')

// ── Windows 防火墙规则（首次运行，静默添加，避免启动时弹出"允许连接网络"拦截框）──────
async function ensureFirewallRule(): Promise<void> {
  if (process.platform !== 'win32') return
  const flagPath = join(app.getPath('userData'), '.firewall-rule-added')
  if (existsSync(flagPath)) return
  await new Promise<void>((resolve) => {
    const child = spawn('netsh', [
      'advfirewall', 'firewall', 'add', 'rule',
      'name=' + FIREWALL_RULE_NAME, 'dir=in', 'action=allow',
      `program=${process.execPath}`, 'enable=yes', 'protocol=TCP'
    ], { windowsHide: true })
    child.on('close', (code) => {
      if (code === 0) { try { writeFileSync(flagPath, '1') } catch { /* ignore */ } }
      resolve()
    })
    child.on('error', () => resolve())
    // 超时保护：5 秒内没有响应就放弃（不阻塞启动）
    setTimeout(() => { try { child.kill() } catch { /* ignore */ } resolve() }, 5000)
  })
}

// ── 单实例锁 ──────────────────────────────────────────────────────────────────
// 若已有实例在运行，聚焦已有窗口并退出本次启动
let mainWindow: BrowserWindow | null = null
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon: APP_ICON,
    // macOS: hiddenInset 保留原生交通灯按钮；Windows/Linux: 完全无边框
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : { frame: false }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  // 窗口控制 IPC（无边框窗口专用，仅 Windows/Linux）
  if (process.platform !== 'darwin') {
    ipcMain.on('window:minimize', () => win.minimize())
    ipcMain.on('window:maximize', () => {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    })
    ipcMain.on('window:close', () => win.close())
    win.on('maximize', () => {
      if (!win.isDestroyed()) win.webContents.send('window:maximized-changed', true)
    })
    win.on('unmaximize', () => {
      if (!win.isDestroyed()) win.webContents.send('window:maximized-changed', false)
    })
  }

  win.on('ready-to-show', () => {
    win.show()
    // if (is.dev) win.webContents.openDevTools()
  })

  if (is.dev) {
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) { // 2=warning, 3=error
        console.log(`[Renderer ${level === 3 ? 'ERROR' : 'WARN'}] ${message} (${sourceId}:${line})`)
      }
    })
  }

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  logger.info(`[Startup] App ready — v${app.getVersion()} pid=${process.pid} platform=${process.platform}`)
  logger.info(`[Startup] Log file: ${logger.getPath()}`)

  electronApp.setAppUserModelId(APP_ID)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  mainWindow = createWindow()

  // Register all IPC handlers
  registerAllIpcHandlers(ipcMain)
  registerAppUpdaterHandlers(ipcMain)

  // 渲染进程可以随时查询当前解压状态（用于挂载后补偿错过的进度推送）
  ipcMain.handle('openclaw:extract-status', () => getExtractState())
  // 用户决定是否升级内置 OpenClaw
  ipcMain.handle('openclaw:upgrade-confirm', () => { confirmUpgrade() })
  ipcMain.handle('openclaw:upgrade-skip', () => { skipUpgrade() })
  // Gateway 日志缓冲（供渲染层切换页面回来时恢复日志面板）
  ipcMain.handle('gateway:logs-get', () => getGatewayLogBuffer())

  // Windows: 先等防火墙规则添加完毕，再启动 Gateway。
  // 若两者并行，Gateway 抢先监听端口会触发系统防火墙弹窗，阻塞用户操作。
  // ensureFirewallRule 内部有 5s 超时保护，不会无限阻塞。
  logger.info('[Startup] ensureFirewallRule — start')
  await ensureFirewallRule()
  logger.info('[Startup] ensureFirewallRule — done')

  // 首次启动：解压 openclaw.zip → resources/openclaw/（仅打包版本执行，dev 自动跳过）
  // 在 autoSpawnBundledOpenclaw 之前完成，确保解压完毕才启动 Gateway。
  logger.info('[Startup] extractOpenClawIfNeeded — start')
  await extractOpenClawIfNeeded(mainWindow, process.resourcesPath)
  logger.info('[Startup] extractOpenClawIfNeeded — done')

  // Gateway 进程日志 → 渲染进程（onboarding 启动日志面板）
  addGatewayLogListener((line, isError) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:log', { line, isError })
    }
  })

  // Spawn bundled openclaw in background — the function synchronously calls
  // patchSettings() before its first `await`, so settings are ready immediately.
  logger.info('[Startup] autoSpawnBundledOpenclaw — start')
  autoSpawnBundledOpenclaw().catch((e) => {
    logger.error(`[AutoSpawn] fatal error: ${e}`)
    console.error('[AutoSpawn] error:', e)
  })

  // Start runtime — pass device identity path so the adapter can authenticate
  // with Ed25519 device identity (3.12+), with automatic fallback to token-only
  // for older gateway versions that don't send a nonce in connect.challenge.
  logger.info('[Startup] startRuntime — start')
  startRuntime((event) => {
    if (is.dev) {
      const evt = event as { type: string; event?: string; payload?: unknown }
      if (evt.type === 'gateway.event' && evt.event === 'chat') {
        const pl = evt.payload as Record<string, unknown> | null
        const msg = pl?.message as Record<string, unknown> | null
        console.log(`[ChatEvent] state=${pl?.state} role=${msg?.role} contentType=${typeof msg?.content} textType=${typeof msg?.text} preview=${JSON.stringify(msg?.content ?? msg?.text ?? '').slice(0, 80)}`)
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:event', event)
      if (is.dev) {
        const evt = event as { type: string; event?: string }
        if (evt.type === 'gateway.event' && evt.event === 'chat') {
          console.log(`[MainProcess] sent chat event to renderer webContentsId=${mainWindow.webContents.id}`)
        }
      }
    }
  }, join(app.getPath('userData'), '.device-identity.json'))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })

  // 初始化 app 自动更新（打包版本）
  initAppUpdater(mainWindow)
})

app.on('window-all-closed', async () => {
  logger.info('[Shutdown] window-all-closed — stopping runtime')
  await stopRuntime()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
