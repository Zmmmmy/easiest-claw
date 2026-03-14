/**
 * app-updater.ts — EasiestClaw 应用自身的自动更新（via GitHub Releases + electron-updater）
 *
 * 工作原理：
 *   electron-updater 从 GitHub Releases 读取 latest.yml / latest-mac.yml
 *   获取最新版本信息并与当前版本对比，检测到新版本后通知渲染进程。
 *   下载和安装都由用户手动触发（autoDownload = false）。
 *
 * IPC 通道（main → renderer push）：
 *   'app:update-status'  payload: AppUpdateStatus
 *
 * IPC handlers（renderer → main）：
 *   'app:check-update'   触发检查
 *   'app:download-update' 开始下载
 *   'app:install-update'  退出并安装
 */

import type { IpcMain, BrowserWindow } from 'electron'
import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { logger } from './lib/logger'

export interface AppUpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  progress?: number   // 0-100，下载进度
  error?: string
}

let _win: BrowserWindow | null = null

function send(payload: AppUpdateStatus): void {
  if (_win && !_win.isDestroyed()) {
    _win.webContents.send('app:update-status', payload)
  }
}

export function initAppUpdater(win: BrowserWindow): void {
  _win = win

  // 开发模式下跳过（electron-updater 在 dev 模式下会失败）
  if (!app.isPackaged) {
    logger.info('[AppUpdater] dev mode — skipping auto-update init')
    return
  }

  // 允许 prerelease（0.x.x-beta 等），不自动下载，让用户决定
  autoUpdater.allowPrerelease = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    logger.info('[AppUpdater] checking-for-update')
    send({ status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    logger.info(`[AppUpdater] update-available — v${info.version}`)
    send({
      status: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    logger.info(`[AppUpdater] update-not-available — current v${info.version}`)
    send({ status: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent)
    logger.info(`[AppUpdater] download-progress ${pct}%`)
    send({ status: 'downloading', progress: pct })
  })

  autoUpdater.on('update-downloaded', (info) => {
    logger.info(`[AppUpdater] update-downloaded — v${info.version}`)
    send({
      status: 'downloaded',
      version: info.version,
    })
  })

  autoUpdater.on('error', (err) => {
    logger.error(`[AppUpdater] error — ${err.message}`)
    send({ status: 'error', error: err.message })
  })

  // 启动后 5 秒静默检查（不干扰启动流程）
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e: Error) => {
      logger.error(`[AppUpdater] checkForUpdates failed: ${e.message}`)
    })
  }, 5000)
}

export function registerAppUpdaterHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('app:check-update', async () => {
    if (!app.isPackaged) return { ok: true, result: { skipped: true, reason: 'dev mode' } }
    try {
      const result = await autoUpdater.checkForUpdates()
      return { ok: true, result: { version: result?.updateInfo?.version } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('app:download-update', async () => {
    if (!app.isPackaged) return { ok: false, error: 'dev mode' }
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('app:install-update', () => {
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('app:paths', () => ({
    appPath: app.isPackaged ? process.resourcesPath : app.getAppPath(),
    userData: app.getPath('userData'),
    logs: app.getPath('logs'),
  }))

  ipcMain.handle('app:open-path', async (_event, targetPath: string) => {
    const err = await shell.openPath(targetPath)
    if (err) logger.warn(`[AppPaths] shell.openPath failed: ${err}`)
  })
}
