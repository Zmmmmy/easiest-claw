import type { IpcMain } from 'electron'
import { app } from 'electron'
import fs from 'fs'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import os from 'os'
import https from 'https'
import { spawn } from 'child_process'
import { stopGatewayProcess, restartBundledGateway, getBundledOpenclawVersion, waitForPortClosed, getBundledNpmBin } from '../gateway/bundled-process'

const REGISTRY = 'https://registry.npmmirror.com'
const REGISTRY_FALLBACK = 'https://registry.npmjs.org'

// 与 bundle-openclaw.mjs 保持同步的包装脚本内容
const EASIEST_CLAW_GATEWAY_SCRIPT = `/**
 * easiest-claw-gateway.mjs — EasiestClaw 包装入口
 * 在 Windows 上 patch child_process，然后启动真正的 OpenClaw Gateway。
 */
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

// openclaw entry.js 的 isMainModule() 通过 argv[1] 或 pm_exec_path 判断主入口。
// easiest-claw-gateway.mjs 不在 ENTRY_WRAPPER_PAIRS 白名单中，需设置 pm_exec_path
// 让 isMainModule 检测通过，否则 entry.js 会跳过执行直接退出（code 0）。
process.env.pm_exec_path = join(dirname(fileURLToPath(import.meta.url)), 'dist', 'entry.js')

if (process.platform === 'win32') {
  const require = createRequire(import.meta.url)
  const cp = require('child_process')

  const _spawn = cp.spawn
  cp.spawn = function (cmd, args, opts) {
    if (!Array.isArray(args)) { opts = args; args = [] }
    return _spawn.call(this, cmd, args, Object.assign({ windowsHide: true }, opts || {}))
  }

  const _spawnSync = cp.spawnSync
  cp.spawnSync = function (cmd, args, opts) {
    if (!Array.isArray(args)) { opts = args; args = [] }
    return _spawnSync.call(this, cmd, args, Object.assign({ windowsHide: true }, opts || {}))
  }

  const _execFile = cp.execFile
  cp.execFile = function (file, args, opts, cb) {
    if (typeof args === 'function') { cb = args; args = []; opts = {} }
    else if (!Array.isArray(args)) { cb = opts; opts = typeof args === 'object' ? args : {}; args = [] }
    else if (typeof opts === 'function') { cb = opts; opts = {} }
    return _execFile.call(this, file, args, Object.assign({ windowsHide: true }, opts || {}), cb)
  }

  const _exec = cp.exec
  cp.exec = function (cmd, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {} }
    return _exec.call(this, cmd, Object.assign({ windowsHide: true }, opts || {}), cb)
  }

  const _execSync = cp.execSync
  cp.execSync = function (cmd, opts) {
    return _execSync.call(this, cmd, Object.assign({ windowsHide: true }, opts || {}))
  }
}

await import('./openclaw.mjs')
`

// ── 路径工具 ──────────────────────────────────────────────────────────────────
function getOpenclawDir(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'openclaw')]
    : [join(app.getAppPath(), 'build', 'openclaw')]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'openclaw.mjs'))) return dir
  }
  return null
}

/** 用内置 npm 安装新增依赖（跳过 optional/peer/dev，避免触碰 git URL 依赖） */
async function runNpmInstall(cwd: string, send: ProgressSender): Promise<boolean> {
  const npmBin = getBundledNpmBin()
  const nodeDir = dirname(npmBin)
  const args = ['install', '--omit=optional', '--omit=peer', '--omit=dev', '--ignore-scripts', '--prefer-offline']
  return new Promise<boolean>((resolve) => {
    const child = spawn(npmBin, args, {
      cwd,
      windowsHide: true,
      shell: process.platform === 'win32', // npm.cmd 是批处理文件，需要 shell
      env: { ...process.env, PATH: `${nodeDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` },
    })
    child.stdout?.on('data', (d: Buffer) => { const l = d.toString().trim(); if (l) send('install', 'running', l) })
    child.stderr?.on('data', (d: Buffer) => { const l = d.toString().trim(); if (l) send('install', 'running', l) })
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

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

// ── npm registry 查询 ─────────────────────────────────────────────────────────
async function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(`${REGISTRY}/openclaw/latest`, { timeout: 10_000 }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        try { resolve((JSON.parse(data) as { version?: string }).version ?? null) }
        catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

async function readCurrentVersion(): Promise<string | null> {
  const dir = getOpenclawDir()
  return dir ? getBundledOpenclawVersion(dir) : null
}

// ── 升级执行 ──────────────────────────────────────────────────────────────────
type ProgressSender = (step: string, status: 'running' | 'done' | 'error', detail?: string) => void

/** 从 registry 获取指定版本的 tarball 下载 URL */
async function fetchTarballUrl(version: string, registry: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(`${registry}/openclaw/${encodeURIComponent(version)}`, { timeout: 15_000 }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        try {
          const meta = JSON.parse(data) as { dist?: { tarball?: string } }
          resolve(meta.dist?.tarball ?? null)
        } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

/** 下载文件到本地路径（支持 HTTP 重定向） */
function downloadFile(url: string, dest: string, maxRedirects = 5): Promise<boolean> {
  return new Promise((resolve) => {
    const tryGet = (u: string, left: number) => {
      https.get(u, { timeout: 120_000 }, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && left > 0) {
          res.resume()
          tryGet(res.headers.location, left - 1)
          return
        }
        if (res.statusCode !== 200) { res.resume(); resolve(false); return }
        const file = fs.createWriteStream(dest)
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve(true) })
        file.on('error', () => resolve(false))
      }).on('error', () => resolve(false))
    }
    tryGet(url, maxRedirects)
  })
}

/**
 * 下载 tarball 并解压，返回解压后的 package/ 目录路径。
 *
 * 策略：仅下载 + 解压，不运行 npm install。
 * 升级时直接复用现有 node_modules（见 performUpgrade），从根本上避免
 * npm 调用 git 的问题（系统无 git、git URL 依赖等）。
 */
async function downloadAndExtract(
  version: string, registry: string, tmpDir: string, send: ProgressSender
): Promise<string | null> {
  send('download', 'running', `查询 ${registry} 包信息...`)
  const tarballUrl = await fetchTarballUrl(version, registry)
  if (!tarballUrl) {
    send('download', 'running', `${registry} 无法获取 openclaw@${version} 信息`)
    return null
  }

  const tgzPath = join(tmpDir, 'openclaw.tgz')
  send('download', 'running', `正在下载 openclaw@${version}...`)
  if (!await downloadFile(tarballUrl, tgzPath)) {
    send('download', 'running', '下载失败')
    return null
  }

  const extractDir = join(tmpDir, 'extracted')
  await fs.promises.mkdir(extractDir, { recursive: true })
  send('download', 'running', '正在解压...')
  const extractOk = await new Promise<boolean>((resolve) => {
    const child = spawn('tar', ['-xzf', tgzPath, '-C', extractDir], { windowsHide: true })
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
  if (!extractOk) {
    send('download', 'running', 'tar 解压失败')
    return null
  }

  const pkgDir = join(extractDir, 'package')
  if (!existsSync(pkgDir)) {
    send('download', 'running', '解压结构异常，找不到 package/ 目录')
    return null
  }

  return pkgDir
}

async function performUpgrade(
  version: string, openclawDir: string, send: ProgressSender
): Promise<{ ok: boolean; error?: string }> {
  const tmpDir = join(os.tmpdir(), `openclaw-update-${Date.now()}`)
  await fs.promises.mkdir(tmpDir, { recursive: true })

  try {
    // ── 1. Stop gateway ───────────────────────────────────────────────────────
    send('stop', 'running', '正在停止 Gateway...')
    stopGatewayProcess()
    const portClosed = await waitForPortClosed(18789, 10_000)
    if (!portClosed) {
      send('stop', 'running', 'Gateway 端口释放较慢，继续等待...')
      await new Promise(r => setTimeout(r, 3000))
    }
    send('stop', 'done', 'Gateway 已停止')

    // ── 2. 下载 tarball → 解压（不运行 npm install）──────────────────────────
    send('download', 'running', `正在下载 openclaw@${version}...`)
    let newSrc: string | null = null
    for (const registry of [REGISTRY, REGISTRY_FALLBACK]) {
      newSrc = await downloadAndExtract(version, registry, tmpDir, send)
      if (newSrc) break
      send('download', 'running', `${registry} 失败，切换到下一个源...`)
    }
    if (!newSrc) {
      send('download', 'error', '下载失败，请检查网络')
      return { ok: false, error: '下载失败' }
    }
    send('download', 'done', `openclaw@${version} 下载完成`)

    // ── 3. 替换源文件（保留 node_modules，step 3.5 再补全新增依赖）───────────────
    send('install', 'running', '正在更新 OpenClaw 源文件...')
    const openclawEntries = await fs.promises.readdir(openclawDir)
    await Promise.all(
      openclawEntries
        .filter(entry => entry !== 'node_modules')
        .map(entry => fs.promises.rm(join(openclawDir, entry), { recursive: true, force: true }))
    )
    const newSrcEntries = await fs.promises.readdir(newSrc)
    await Promise.all(
      newSrcEntries
        .filter(entry => entry !== 'node_modules')
        .map(entry => fs.promises.cp(join(newSrc, entry), join(openclawDir, entry), { recursive: true }))
    )
    send('install', 'done', `文件更新完成，当前版本 ${version}`)

    // ── 3.5. 补全新增依赖（跳过 optional/peer，不触碰 git URL 依赖）────────────
    // 新版 openclaw 可能新增了普通 npm 依赖（如 @modelcontextprotocol/sdk），
    // 需要用内置 npm 补装；libsignal 等 git URL 依赖已是 stub，--omit=optional 跳过。
    send('install', 'running', '正在补全新增依赖...')
    const npmOk = await runNpmInstall(openclawDir, send)
    if (npmOk) {
      send('install', 'running', '依赖补全完成')
    } else {
      send('install', 'running', '依赖补全未完全成功，已继续（部分新功能可能不可用）')
    }

    // ── 4. 写入 easiest-claw-gateway.mjs（含 pm_exec_path 修复）──────────────
    await fs.promises.writeFile(join(openclawDir, 'easiest-claw-gateway.mjs'), EASIEST_CLAW_GATEWAY_SCRIPT)

    // ── 5. 重启 Gateway ───────────────────────────────────────────────────────
    send('start', 'running', '正在重启 Gateway...')
    const started = await restartBundledGateway()
    if (started) {
      send('start', 'done', 'Gateway 已重启')
    } else {
      // 90s 内未就绪也算升级成功 — Gateway 仍在启动中，自动重试会继续连接
      send('start', 'done', 'Gateway 正在后台启动，升级已完成，稍后将自动连接')
    }

    return { ok: true }
  } finally {
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
export const registerUpdateHandlers = (ipcMain: IpcMain): void => {

  // 检查更新
  ipcMain.handle('openclaw:check-update', async () => {
    const current = await readCurrentVersion()
    const latest = await fetchLatestVersion()
    const hasUpdate = !!(current && latest && isNewer(latest, current))
    return { ok: true, result: { current, latest, hasUpdate } }
  })

  // 执行升级（统一走内置路径）
  ipcMain.handle('openclaw:upgrade', async (event, { version }: { version: string }) => {
    const send: ProgressSender = (step, status, detail) => {
      console.log(`[Update:${step}][${status}] ${detail ?? ''}`)
      try { event.sender.send('openclaw:upgrade-progress', { step, status, detail }) } catch {}
    }

    const openclawDir = getOpenclawDir()
    if (!openclawDir) return { ok: false, error: '找不到内置 OpenClaw 目录' }
    return performUpgrade(version, openclawDir, send)
  })
}
