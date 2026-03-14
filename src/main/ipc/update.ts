import type { IpcMain } from 'electron'
import { app } from 'electron'
import fs from 'fs'
import { existsSync } from 'fs'
import { join } from 'path'
import os from 'os'
import https from 'https'
import { spawn } from 'child_process'
import { stopGatewayProcess, restartBundledGateway, getBundledOpenclawVersion, waitForPortClosed } from '../gateway/bundled-process'

const REGISTRY = 'https://registry.npmmirror.com'

const UNUSED_LARGE_PKGS = [
  'koffi', 'pdfjs-dist', 'node-llama-cpp', '@node-llama-cpp',
  'playwright-core', '@playwright', 'typescript', '@cloudflare',
]

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

function getNpmArgs(version: string): { cmd: string; args: string[]; shell: boolean } {
  const nodeDir = app.isPackaged
    ? join(process.resourcesPath, 'node')
    : join(app.getAppPath(), 'resources', 'node')

  const installArgs = ['install', `openclaw@${version}`, '--registry', REGISTRY, '--no-audit', '--no-fund']

  if (process.platform === 'win32') {
    const cmd = join(nodeDir, 'npm.cmd')
    if (!existsSync(cmd)) throw new Error(`找不到内置 npm: ${cmd}`)
    return { cmd, args: installArgs, shell: true }
  } else {
    // macOS / Linux：直接用 node 运行 npm-cli.js，避免 shell 脚本相对路径问题
    const nodeExe = join(nodeDir, 'node')
    const npmCli = join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (!existsSync(npmCli)) throw new Error(`找不到内置 npm-cli: ${npmCli}`)
    return { cmd: nodeExe, args: [npmCli, ...installArgs], shell: false }
  }
}

// ── 版本比较（支持 YYYY.M.D 和 semver，忽略提交哈希后缀）──────────────────────
function parseVersion(v: string): number[] {
  // 去掉空格后的内容：'2026.3.8 (3caab92)' → '2026.3.8'
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

async function runNpmInstall(
  version: string, tmpDir: string, send: ProgressSender
): Promise<boolean> {
  // libsignal-node 是 git 依赖，国内无法访问；用本地 stub 替代
  const stubDir = join(tmpDir, '_stubs', 'libsignal-node')
  await fs.promises.mkdir(stubDir, { recursive: true })
  await fs.promises.writeFile(
    join(stubDir, 'package.json'),
    JSON.stringify({ name: 'libsignal-node', version: '5.0.0', main: 'index.js' })
  )
  await fs.promises.writeFile(join(stubDir, 'index.js'), 'module.exports = {};\n')
  await fs.promises.writeFile(join(tmpDir, 'package.json'), JSON.stringify({
    name: '_openclaw_update', version: '1.0.0', private: true,
    overrides: { 'libsignal-node': `file:${stubDir.replace(/\\/g, '/')}` },
  }))

  const { cmd, args, shell } = getNpmArgs(version)

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: tmpDir,
      shell,
      windowsHide: true,
    })
    const handleOut = (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        if (line.trim()) send('download', 'running', line.trim())
      }
    }
    child.stdout?.on('data', handleOut)
    child.stderr?.on('data', handleOut)
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
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
    // 等待 TCP 端口真正释放，避免 Windows 文件锁导致后续替换失败
    const portClosed = await waitForPortClosed(18789, 10_000)
    if (!portClosed) {
      send('stop', 'running', 'Gateway 端口释放较慢，继续等待...')
      await new Promise(r => setTimeout(r, 3000))
    }
    send('stop', 'done', 'Gateway 已停止')

    // ── 2. npm install 到临时目录 ─────────────────────────────────────────────
    send('download', 'running', `正在下载 openclaw@${version}...`)
    const npmOk = await runNpmInstall(version, tmpDir, send)
    if (!npmOk) {
      send('download', 'error', 'npm install 失败，请检查网络或版本号')
      return { ok: false, error: 'npm install 失败' }
    }
    send('download', 'done', `openclaw@${version} 下载完成`)

    const newSrc = join(tmpDir, 'node_modules', 'openclaw')
    if (!existsSync(newSrc)) {
      send('install', 'error', '安装包结构异常，找不到 openclaw 目录')
      return { ok: false, error: '安装包结构异常' }
    }

    // ── 3. 替换源文件（保留 node_modules，单独处理）────────────────────────────
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

    // ── 4. 更新 node_modules ─────────────────────────────────────────────────
    send('install', 'running', '正在更新依赖...')
    const outMods = join(openclawDir, 'node_modules')
    await fs.promises.mkdir(outMods, { recursive: true })
    const tmpMods = join(tmpDir, 'node_modules')
    const pkgEntries = await fs.promises.readdir(tmpMods)
    for (const pkg of pkgEntries) {
      if (pkg === 'openclaw' || pkg === '.package-lock.json') continue
      const dest = join(outMods, pkg)
      if (existsSync(dest)) await fs.promises.rm(dest, { recursive: true, force: true })
      await fs.promises.cp(join(tmpMods, pkg), dest, { recursive: true })
    }

    // ── 5. 删除不需要的大包 ───────────────────────────────────────────────────
    await Promise.all(
      UNUSED_LARGE_PKGS.map(async (pkg) => {
        const p = join(outMods, pkg)
        if (existsSync(p)) {
          await fs.promises.rm(p, { recursive: true, force: true })
          send('install', 'running', `已删除 ${pkg}`)
        }
      })
    )

    // ── 6. 写入 easiest-claw-gateway.mjs（含 pm_exec_path 修复）──────────────────
    await fs.promises.writeFile(join(openclawDir, 'easiest-claw-gateway.mjs'), EASIEST_CLAW_GATEWAY_SCRIPT)
    send('install', 'done', `文件更新完成，当前版本 ${version}`)

    // ── 7. 重启 Gateway（强制 fork 内置，跳过 autoSpawn 的端口前置检查）───────────
    send('start', 'running', '正在重启 Gateway...')
    const started = await restartBundledGateway()
    if (!started) {
      send('start', 'error', 'Gateway 重启超时，请重新打开应用')
      return { ok: false, error: 'Gateway 重启超时' }
    }
    send('start', 'done', 'Gateway 已重启')

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
