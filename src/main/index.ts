import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerAllIpcHandlers } from './ipc'
import { startRuntime, stopRuntime } from './gateway/runtime'
import { autoSpawnBundledOpenclaw, addGatewayLogListener, getGatewayLogBuffer } from './gateway/bundled-process'
import { extractOpenClawIfNeeded, getExtractState, confirmUpgrade, skipUpgrade } from './openclaw-init'
import { migrateDataDirIfNeeded } from './lib/data-dir'
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

// ── 首次启动：选择数据目录 ────────────────────────────────────────────────────
async function checkAndPromptDataLocation(): Promise<void> {
  const settingsFile = join(app.getPath('userData'), 'settings.json')
  let settings: Record<string, unknown> = {}

  if (existsSync(settingsFile)) {
    try {
      settings = JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
    } catch {}
  }

  if (settings.dataLocationSelected) return

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 320,
      frame: false,
      transparent: true,
      resizable: false,
      center: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true
      }
    })

    win.loadFile(join(__dirname, 'data-location-prompt.html'))
    win.once('ready-to-show', () => win.show())

    ipcMain.handle('data-location:choose', async () => {
      const result = await dialog.showOpenDialog(win, {
        title: '选择数据存储目录',
        defaultPath: app.getPath('home'),
        properties: ['openDirectory', 'createDirectory']
      })
      if (!result.canceled && result.filePaths[0]) {
        settings.customDataDir = result.filePaths[0]
      }
      settings.dataLocationSelected = true
      writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8')
      win.close()
      resolve()
    })

    ipcMain.handle('data-location:default', () => {
      settings.dataLocationSelected = true
      writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8')
      win.close()
      resolve()
    })
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

  // 首次启动：选择数据目录
  await checkAndPromptDataLocation()

  // 数据目录迁移（在解压前执行，避免解压到旧位置）
  await migrateDataDirIfNeeded()

  // 防火墙规则 + 解压并行执行：两者互不依赖，无需串行等待。
  // 防火墙规则需在 gateway 监听端口前完成（否则触发弹窗），
  // 解压需在 autoSpawnBundledOpenclaw 前完成（依赖解压产物）。
  // Promise.all 保证两者都完成后才继续。
  logger.info('[Startup] ensureFirewallRule + extractOpenClawIfNeeded — start (parallel)')
  await Promise.all([
    ensureFirewallRule(),
    extractOpenClawIfNeeded(mainWindow, process.resourcesPath),
  ])
  logger.info('[Startup] ensureFirewallRule + extractOpenClawIfNeeded — done')

  // Gateway 进程日志 → 渲染进程（onboarding 启动日志面板）
  addGatewayLogListener((line, isError) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:log', { line, isError })
    }
  })

  // Spawn bundled openclaw — await so gateway is ready before runtime connects.
  // patchSettings() is called synchronously inside before the first await.
  logger.info('[Startup] autoSpawnBundledOpenclaw — start')
  await autoSpawnBundledOpenclaw().catch((e) => {
    logger.error(`[AutoSpawn] fatal error: ${e}`)
    console.error('[AutoSpawn] error:', e)
  })

  // Start runtime AFTER gateway is ready — avoids ECONNREFUSED retry spam.
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
