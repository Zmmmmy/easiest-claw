import type { IpcMain } from 'electron'
import { Worker } from 'worker_threads'
import { createRequire } from 'module'
import fs from 'fs'
import { existsSync } from 'fs'
import { join } from 'path'
import os from 'os'
import https from 'https'
import http from 'http'
import {
  stopGatewayGracefully,
  restartBundledGateway,
  getBundledOpenclawVersion,
  waitForPortClosed,
  getGatewayLogBuffer,
  GATEWAY_PORT,
} from '../gateway/bundled-process'
import { findOpenclawDir } from '../lib/openclaw-paths'
import { getDataDir } from '../lib/data-dir'
import { logger } from '../lib/logger'

// ── GitHub Release 配置 ──────────────────────────────────────────────────────
const GITHUB_REPO = 'Zmmmmy/easiest-claw-open-claw-upgrade'
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
// GitHub API 镜像（国内加速），按优先级尝试
const GITHUB_API_MIRRORS = [
  GITHUB_API,
  `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
]
// 下载加速镜像前缀（对 github.com release assets 进行代理）
const DOWNLOAD_MIRRORS = [
  '', // 原始 GitHub URL
  'https://gh-proxy.com/',
  'https://ghproxy.cc/',
]

const ZIP_NAMES = ['openclaw-core.zip', 'openclaw-mods-a.zip', 'openclaw-mods-b.zip'] as const

// ── 路径工具 ─────────────────────────────────────────────────────────────────
const getOpenclawDir = findOpenclawDir

// ── 版本比较（支持 YYYY.M.D 和 semver，忽略提交哈希后缀）──────────────────────
function parseVersion(v: string): number[] {
  const clean = v.trim().replace(/\s.*$/, '').replace(/^[^0-9]*/, '')
  return clean.split('.').map(s => { const n = parseInt(s, 10); return isNaN(n) ? 0 : n })
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    if (ai > bi) return true
    if (ai < bi) return false
  }
  return false
}

// ── GitHub Release 查询 ──────────────────────────────────────────────────────
interface ReleaseAsset { name: string; browser_download_url: string; size: number }
interface ReleaseInfo { tag_name: string; assets: ReleaseAsset[] }

async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  for (const apiUrl of GITHUB_API_MIRRORS) {
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const req = https.get(apiUrl, {
          timeout: 15_000,
          headers: { 'User-Agent': 'EasiestClaw-Desktop', Accept: 'application/vnd.github.v3+json' },
        }, (res) => {
          if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return }
          let body = ''
          res.on('data', (chunk: Buffer) => { body += chunk.toString() })
          res.on('end', () => resolve(body))
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
      })
      const release = JSON.parse(data) as ReleaseInfo
      if (release.tag_name && Array.isArray(release.assets)) return release
    } catch (e) {
      logger.warn(`[Update] fetch release from ${apiUrl} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return null
}

function extractVersionFromTag(tag: string): string {
  return tag.replace(/^v/, '').trim()
}

async function readCurrentVersion(): Promise<string | null> {
  const dir = getOpenclawDir()
  return dir ? getBundledOpenclawVersion(dir) : null
}

// ── 升级步骤定义（与渲染端 UI 统一）────────────────────────────────────────────
export const UPGRADE_STEPS = ['download', 'stop', 'migrate', 'install', 'start'] as const
export type UpgradeStep = typeof UPGRADE_STEPS[number]
type UpgradeStepStatus = 'pending' | 'running' | 'done' | 'error'

// ── 模块级升级状态（供渲染层挂载时查询，页面切换后恢复）──────────────────────────
const _upgradeState: {
  running: boolean
  steps: Record<string, { status: UpgradeStepStatus; logs: string[] }>
} = { running: false, steps: {} }

for (const s of UPGRADE_STEPS) _upgradeState.steps[s] = { status: 'pending', logs: [] }

function resetUpgradeState(): void {
  _upgradeState.running = true
  for (const s of UPGRADE_STEPS) _upgradeState.steps[s] = { status: 'pending', logs: [] }
}

// ── 进度发送器类型 ─────────────────────────────────────────────────────────────
type ProgressSender = (step: string, status: 'running' | 'done' | 'error', detail?: string) => void

// ── HTTP 下载工具（支持跟随重定向，超时可配）────────────────────────────────────
function httpGet(url: string, timeout = 60_000): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    const req = protocol.get(url, {
      timeout,
      headers: { 'User-Agent': 'EasiestClaw-Desktop' },
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        res.resume()
        httpGet(res.headers.location, timeout).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      resolve(res)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
  })
}

// ── Step 1: 下载 3 个 zip 文件 ───────────────────────────────────────────────
async function downloadFile(
  url: string, destPath: string, label: string,
  send: ProgressSender, expectedSize: number
): Promise<boolean> {
  for (const mirrorPrefix of DOWNLOAD_MIRRORS) {
    const fullUrl = mirrorPrefix ? mirrorPrefix + url : url
    try {
      send('download', 'running', `正在下载 ${label}...`)
      const res = await httpGet(fullUrl, 120_000)
      const totalBytes = parseInt(res.headers['content-length'] ?? '0', 10) || expectedSize
      let downloaded = 0

      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(destPath)
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          if (totalBytes > 0) {
            const pct = Math.round((downloaded / totalBytes) * 100)
            send('download', 'running', `${label}: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`)
          }
        })
        res.pipe(ws)
        ws.on('finish', resolve)
        ws.on('error', reject)
        res.on('error', reject)
      })

      // 验证文件大小合理（至少 100KB）
      const stat = await fs.promises.stat(destPath)
      if (stat.size < 100 * 1024) {
        send('download', 'running', `${label} 文件过小 (${stat.size} bytes)，切换镜像...`)
        continue
      }
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      send('download', 'running', `${label} 下载失败 (${mirrorPrefix || 'github'}): ${msg}`)
      logger.warn(`[Update] download ${label} failed from ${fullUrl}: ${msg}`)
    }
  }
  return false
}

async function downloadAllZips(
  assets: ReleaseAsset[], downloadDir: string, send: ProgressSender
): Promise<boolean> {
  for (const zipName of ZIP_NAMES) {
    const asset = assets.find(a => a.name === zipName)
    if (!asset) {
      send('download', 'error', `Release 中缺少 ${zipName}`)
      return false
    }
    const destPath = join(downloadDir, zipName)
    const ok = await downloadFile(asset.browser_download_url, destPath, zipName, send, asset.size)
    if (!ok) {
      send('download', 'error', `${zipName} 下载失败`)
      return false
    }
  }
  return true
}

// ── Step 2: 并行解压 3 个 zip（复用 openclaw-init.ts 的 worker 模式）──────────
// adm-zip worker 代码（与 openclaw-init.ts 中的 WORKER_CODE 保持一致）
const WORKER_CODE = `
'use strict'
const { workerData, parentPort } = require('worker_threads')
const AdmZip = require(workerData.admZipPath)
const { zipPath, destDir } = workerData

const zip = new AdmZip(zipPath)
const entries = zip.getEntries().filter(e => !e.isDirectory)
const total = entries.length
const failedEntries = []

;(async () => {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    try {
      zip.extractEntryTo(entry.entryName, destDir, true, true)
    } catch (err) {
      failedEntries.push({ name: entry.entryName, error: err.message })
    }
    if (i % 80 === 0 || i === entries.length - 1) {
      parentPort.postMessage({ type: 'progress', extracted: i + 1, total, file: entry.entryName })
      await new Promise(r => setImmediate(r))
    }
  }
  parentPort.postMessage({ type: 'done', failedCount: failedEntries.length, failedEntries: failedEntries.slice(0, 20) })
})().catch(err => parentPort.postMessage({ type: 'error', message: err.message }))
`

async function extractZips(
  downloadDir: string, destDir: string, send: ProgressSender
): Promise<string | null> {
  const zipPaths = ZIP_NAMES.map(n => join(downloadDir, n))
  const missing = zipPaths.filter(p => !existsSync(p))
  if (missing.length > 0) return `缺少 zip 文件: ${missing.map(p => p.split(/[\\/]/).pop()).join(', ')}`

  send('install', 'running', '正在并行解压 3 个 zip...')

  // adm-zip 路径（主线程解析，传给 worker 避免 ASAR 问题）
  const _require = createRequire(import.meta.url)
  const admZipPath: string = _require.resolve('adm-zip')

  // zip 内部路径带 openclaw/ 前缀，extractEntryTo 的目标传 destDir 的父目录
  // 解压后形成 destDir/openclaw/... 结构
  // 但我们要解压到 destDir 本身，所以目标是 destDir 的父目录
  const extractRoot = join(destDir, '..')

  // 清除旧的目标目录
  const openclawSubDir = join(extractRoot, 'openclaw')
  if (existsSync(openclawSubDir)) {
    await fs.promises.rm(openclawSubDir, { recursive: true, force: true })
  }

  const workerProgress: Record<string, { extracted: number; total: number }> = {}
  for (const zp of zipPaths) workerProgress[zp] = { extracted: 0, total: 1 }

  const workerPromises = zipPaths.map(
    (zipPath) =>
      new Promise<void>((resolve, reject) => {
        const worker = new Worker(WORKER_CODE, {
          eval: true,
          workerData: { zipPath, destDir: extractRoot, admZipPath },
        })
        worker.on('message', (msg: {
          type: string; extracted?: number; total?: number; file?: string
          message?: string; failedCount?: number; failedEntries?: { name: string; error: string }[]
        }) => {
          if (msg.type === 'progress' && msg.extracted !== undefined && msg.total !== undefined) {
            workerProgress[zipPath] = { extracted: msg.extracted, total: msg.total }
            const totalExtracted = Object.values(workerProgress).reduce((s, p) => s + p.extracted, 0)
            const totalFiles = Object.values(workerProgress).reduce((s, p) => s + p.total, 0)
            const pct = totalFiles > 0 ? Math.round((totalExtracted / totalFiles) * 100) : 0
            send('install', 'running', `解压中... ${pct}%`)
          } else if (msg.type === 'done') {
            if (msg.failedCount && msg.failedCount > 0) {
              logger.warn(`[Update] extract done with ${msg.failedCount} failures: ${zipPath}`)
            }
            resolve()
          } else if (msg.type === 'error') {
            reject(new Error(msg.message))
          }
        })
        worker.on('error', reject)
        worker.on('exit', (code) => {
          if (code !== 0) reject(new Error(`Worker exited code=${code}`))
        })
      })
  )

  try {
    await Promise.all(workerPromises)
  } catch (e) {
    return `解压失败: ${e instanceof Error ? e.message : String(e)}`
  }

  // 验证关键文件
  const criticalFiles = [
    join(openclawSubDir, 'openclaw.mjs'),
    join(openclawSubDir, 'dist', 'entry.js'),
  ]
  const missingFiles = criticalFiles.filter(f => !existsSync(f))
  if (missingFiles.length > 0) {
    return `解压后缺少关键文件: ${missingFiles.map(f => f.split(/[\\/]/).pop()).join(', ')}`
  }

  send('install', 'done', '解压完成')
  return null
}

// ── 回滚：恢复备份并重启旧 Gateway ───────────────────────────────────────────
async function rollback(
  openclawDir: string, backupDir: string, send: ProgressSender
): Promise<void> {
  send('migrate', 'running', '正在回滚...')
  try {
    if (existsSync(openclawDir)) {
      await fs.promises.rm(openclawDir, { recursive: true, force: true })
    }
    if (existsSync(backupDir)) {
      await fs.promises.rename(backupDir, openclawDir)
      send('migrate', 'done', '已恢复旧版本')
    } else {
      send('migrate', 'error', '备份不存在，无法回滚')
    }
  } catch (e) {
    send('migrate', 'error', `回滚失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ── Windows rename 重试（进程退出后文件句柄释放有延迟）──────────────────────────
async function renameWithRetry(
  src: string, dest: string, send: ProgressSender, maxAttempts = 5
): Promise<void> {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await fs.promises.rename(src, dest)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (i < maxAttempts && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
        send('migrate', 'running', `文件被占用，等待重试 (${i}/${maxAttempts})...`)
        logger.warn(`[Update] rename ${src} failed (${code}), retry ${i}/${maxAttempts}`)
        await new Promise(r => setTimeout(r, 2000))
        continue
      }
      throw e
    }
  }
}

// ── 主升级函数 ─────────────────────────────────────────────────────────────────
async function performUpgrade(
  version: string, assets: ReleaseAsset[], openclawDir: string, send: ProgressSender
): Promise<{ ok: boolean; error?: string }> {
  const downloadDir = join(os.tmpdir(), `openclaw-upgrade-${version}-${Date.now()}`)
  const backupDir = openclawDir + '.backup'
  // zip 解压到 openclawDir 的父目录（zip 内部自带 openclaw/ 前缀）
  // extractZips 会解压到 extractRoot/openclaw/，即 stagingOcDir
  const extractRoot = join(openclawDir, '..') // e.g. userData/
  const stagingOcDir = join(extractRoot, 'openclaw') // 解压产物会在这里（如果 openclawDir 就是这个路径）
  // 但 openclawDir 可能就是 extractRoot/openclaw，需要先 rename 走
  let gatewayWasStopped = false

  try {
    await fs.promises.mkdir(downloadDir, { recursive: true })
    if (existsSync(backupDir)) {
      await fs.promises.rm(backupDir, { recursive: true, force: true })
    }

    // ── Step 1: 下载 3 个 zip（gateway 仍在运行，用户无感知）──────────────────
    send('download', 'running', `正在下载 OpenClaw ${version} 升级包...`)
    const downloadOk = await downloadAllZips(assets, downloadDir, send)
    if (!downloadOk) {
      send('download', 'error', '下载失败，请检查网络连接')
      return { ok: false, error: '下载失败' }
    }
    send('download', 'done', '所有文件下载完成')

    // ── Step 2: 停止 gateway（解压前停止，避免 Windows 文件锁）───────────────
    send('stop', 'running', '正在停止 Gateway...')
    await stopGatewayGracefully(5_000)
    gatewayWasStopped = true

    const portClosed = await waitForPortClosed(GATEWAY_PORT, 15_000)
    if (!portClosed) {
      send('stop', 'error', 'Gateway 端口未在 15s 内释放，升级中止')
      try { await restartBundledGateway() } catch {}
      return { ok: false, error: 'Gateway 停止超时' }
    }
    send('stop', 'done', 'Gateway 已停止')

    // ── Step 3: 备份旧版本 ──────────────────────────────────────────────────
    send('migrate', 'running', '正在备份旧版本...')
    await renameWithRetry(openclawDir, backupDir, send)
    send('migrate', 'running', '旧版本已备份')

    // ── Step 4: 并行解压 3 个 zip → openclawDir ─────────────────────────────
    send('install', 'running', '正在解压新版本...')
    const extractErr = await extractZips(downloadDir, openclawDir, send)
    if (extractErr) {
      send('install', 'error', extractErr)
      // 回滚
      await rollback(openclawDir, backupDir, send)
      try { await restartBundledGateway() } catch {}
      return { ok: false, error: extractErr }
    }

    // 验证解压后的版本
    const extractedVersion = await getBundledOpenclawVersion(openclawDir)
    if (extractedVersion && extractedVersion !== version) {
      logger.warn(`[Update] version mismatch: expected ${version}, got ${extractedVersion}`)
    }

    // 写入版本标记（供 openclaw-init.ts 的解压跳过逻辑使用）
    const markerPath = join(getDataDir(), '.openclaw-version')
    try { await fs.promises.writeFile(markerPath, version, 'utf8') } catch {}

    send('install', 'done', '新版本解压完成')

    // ── Step 5: 启动新版本 ─────────────────────────────────────────────────
    send('start', 'running', '正在启动新版 Gateway...')
    const started = await restartBundledGateway()

    if (!started) {
      const recentLogs = getGatewayLogBuffer()
        .filter(l => l.isError)
        .slice(-5)
        .map(l => l.line)
      const logHint = recentLogs.length > 0
        ? `\n最近错误:\n${recentLogs.join('\n')}`
        : ''
      send('start', 'error', `新版 Gateway 启动失败，正在回滚...${logHint}`)
      await rollback(openclawDir, backupDir, send)
      try { await restartBundledGateway() } catch {}
      return { ok: false, error: `新版 Gateway 启动失败，已回滚至旧版本${logHint}` }
    }

    send('start', 'done', `升级完成，当前版本 ${version}`)

    // 异步清理
    fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => {})
    fs.promises.rm(downloadDir, { recursive: true, force: true }).catch(() => {})

    return { ok: true }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    send('install', 'error', `升级异常: ${msg}`)
    logger.error(`[Update] upgrade error: ${err}`)

    if (gatewayWasStopped) {
      await rollback(openclawDir, backupDir, send)
      try { await restartBundledGateway() } catch {}
    }
    return { ok: false, error: msg }

  } finally {
    if (existsSync(downloadDir)) {
      fs.promises.rm(downloadDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
export const registerUpdateHandlers = (ipcMain: IpcMain): void => {

  // 检查更新（从 GitHub Release API 查询）
  ipcMain.handle('openclaw:check-update', async () => {
    const current = await readCurrentVersion()
    const release = await fetchLatestRelease()
    const latest = release ? extractVersionFromTag(release.tag_name) : null
    const hasUpdate = !!(current && latest && isNewer(latest, current))
    return { ok: true, result: { current, latest, hasUpdate } }
  })

  // 执行升级（下载 zip + 解压，无需 npm install）
  ipcMain.handle('openclaw:upgrade', async (event, { version }: { version: string }) => {
    resetUpgradeState()
    const send: ProgressSender = (step, status, detail) => {
      logger.info(`[Update:${step}][${status}] ${detail ?? ''}`)
      const stepState = _upgradeState.steps[step]
      if (stepState) {
        stepState.status = status
        if (status === 'running' && detail) {
          stepState.logs = [...stepState.logs.slice(-299), detail]
        }
      }
      try { event.sender.send('openclaw:upgrade-progress', { step, status, detail }) } catch {}
    }

    const openclawDir = getOpenclawDir()
    if (!openclawDir) {
      _upgradeState.running = false
      return { ok: false, error: '找不到内置 OpenClaw 目录' }
    }

    // 获取 Release assets 列表
    const release = await fetchLatestRelease()
    if (!release) {
      _upgradeState.running = false
      return { ok: false, error: '无法获取 GitHub Release 信息' }
    }

    const result = await performUpgrade(version, release.assets, openclawDir, send)
    _upgradeState.running = false
    return result
  })

  // 查询当前升级状态（渲染层切换页面回来时初始化用）
  ipcMain.handle('openclaw:upgrade-state', () => _upgradeState)
}
