import type { IpcMain } from 'electron'
import { app } from 'electron'
import fs from 'fs'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import os from 'os'
import https from 'https'
import { spawn } from 'child_process'
import { stopGatewayProcess, restartBundledGateway, getBundledOpenclawVersion, waitForPortClosed, getBundledNpmBin, getBundledGitBin } from '../gateway/bundled-process'

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

// 升级后删除的大型无用包（与 bundle-openclaw.mjs 保持同步）
const UNUSED_LARGE_PKGS = [
  'koffi', 'pdfjs-dist', 'node-llama-cpp', '@node-llama-cpp',
  'playwright-core', '@playwright', 'typescript', '@cloudflare',
]

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

/**
 * 用内置 npm 在 wrapper 目录安装指定版本的 openclaw 及全部依赖。
 *
 * 策略与 bundle-openclaw.mjs 完全相同：
 *   1. 建 wrapper package.json，把 openclaw 列为 dependency，libsignal-node 用 stub override
 *   2. 运行 `npm install openclaw@version`（先镜像源，失败再官方源）
 *   3. 返回 wrapper 的 node_modules 目录（npm 已把 openclaw 及其全部依赖装进去）
 */
async function installOpenclawInWrapper(
  version: string, wrapperDir: string, send: ProgressSender
): Promise<boolean> {
  // 写 libsignal-node stub（避免 git clone 失败）
  const stubDir = join(wrapperDir, '_stubs', 'libsignal-node')
  await fs.promises.mkdir(stubDir, { recursive: true })
  await fs.promises.writeFile(join(stubDir, 'package.json'),
    JSON.stringify({ name: 'libsignal-node', version: '5.0.0', main: 'index.js' }))
  await fs.promises.writeFile(join(stubDir, 'index.js'), 'module.exports = {};\n')
  const stubPath = stubDir.replace(/\\/g, '/')

  // 写 wrapper package.json
  await fs.promises.writeFile(join(wrapperDir, 'package.json'), JSON.stringify({
    name: '_openclaw_update',
    version: '1.0.0',
    private: true,
    dependencies: { openclaw: version },
    overrides: { 'libsignal-node': `file:${stubPath}` },
  }, null, 2))

  const npmBin = getBundledNpmBin()
  const nodeDir = dirname(npmBin)
  const baseArgs = ['install', '--no-audit', '--no-fund', '--ignore-scripts']

  const pathSep = process.platform === 'win32' ? ';' : ':'
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: `${nodeDir}${pathSep}${process.env.PATH ?? ''}`,
  }
  // Windows 使用内置 MinGit；macOS/Linux 系统自带 git，无需额外设置
  const bundledGit = getBundledGitBin()
  if (bundledGit) env.npm_config_git = bundledGit

  for (const registry of [REGISTRY, REGISTRY_FALLBACK]) {
    send('download', 'running', `正在从 ${registry} 安装 openclaw@${version}...`)
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(npmBin, [...baseArgs, '--registry', registry], {
        cwd: wrapperDir,
        windowsHide: true,
        shell: process.platform === 'win32',
        env,
      })
      child.stdout?.on('data', (d: Buffer) => { const l = d.toString().trim(); if (l) send('download', 'running', l) })
      child.stderr?.on('data', (d: Buffer) => { const l = d.toString().trim(); if (l) send('download', 'running', l) })
      child.on('close', (code) => resolve(code === 0))
      child.on('error', () => resolve(false))
    })
    if (ok) return true
    send('download', 'running', `${registry} 安装失败，切换到下一个源...`)
  }
  return false
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

    // ── 2. npm install openclaw@version（含全部依赖，libsignal stub override）──
    // 与 bundle-openclaw.mjs 策略相同，彻底避免手动 tarball + 依赖缺失问题
    const wrapperDir = join(tmpDir, 'wrapper')
    await fs.promises.mkdir(wrapperDir, { recursive: true })
    const installOk = await installOpenclawInWrapper(version, wrapperDir, send)
    if (!installOk) {
      send('download', 'error', '安装失败，请检查网络')
      return { ok: false, error: '安装失败' }
    }
    send('download', 'done', `openclaw@${version} 安装完成`)

    // ── 3. 替换源文件（保留旧 node_modules，再用新 node_modules 覆盖/补全）────
    send('install', 'running', '正在更新 OpenClaw 文件...')

    const newOpenclawSrc = join(wrapperDir, 'node_modules', 'openclaw')
    if (!existsSync(newOpenclawSrc)) {
      send('install', 'error', 'npm 安装结果异常，找不到 openclaw 包')
      return { ok: false, error: 'npm 安装结果异常' }
    }

    // 替换源文件（不含 node_modules）
    const openclawEntries = await fs.promises.readdir(openclawDir)
    await Promise.all(
      openclawEntries
        .filter(entry => entry !== 'node_modules')
        .map(entry => fs.promises.rm(join(openclawDir, entry), { recursive: true, force: true }))
    )
    const newSrcEntries = await fs.promises.readdir(newOpenclawSrc)
    await Promise.all(
      newSrcEntries
        .filter(entry => entry !== 'node_modules')
        .map(entry => fs.promises.cp(join(newOpenclawSrc, entry), join(openclawDir, entry), { recursive: true }))
    )

    // 将新安装的依赖覆盖/写入 openclawDir/node_modules
    const wrapperMods = join(wrapperDir, 'node_modules')
    const newModEntries = await fs.promises.readdir(wrapperMods)
    const targetMods = join(openclawDir, 'node_modules')
    await fs.promises.mkdir(targetMods, { recursive: true })
    await Promise.all(
      newModEntries
        .filter(e => e !== 'openclaw' && e !== '.package-lock.json')
        .map(async e => {
          const dest = join(targetMods, e)
          // 先删后复制，确保版本更新
          if (existsSync(dest)) await fs.promises.rm(dest, { recursive: true, force: true })
          await fs.promises.cp(join(wrapperMods, e), dest, { recursive: true })
        })
    )

    // 删除运行时不需要的大型包（与 bundle-openclaw.mjs 保持同步）
    for (const pkg of UNUSED_LARGE_PKGS) {
      const p = join(targetMods, pkg)
      if (existsSync(p)) await fs.promises.rm(p, { recursive: true, force: true })
    }

    send('install', 'done', `更新完成，当前版本 ${version}`)

    // ── 4. 写入 easiest-claw-gateway.mjs（含 pm_exec_path 修复）──────────────
    await fs.promises.writeFile(join(openclawDir, 'easiest-claw-gateway.mjs'), EASIEST_CLAW_GATEWAY_SCRIPT)

    // ── 5. 重启 Gateway ───────────────────────────────────────────────────────
    send('start', 'running', '正在重启 Gateway...')
    const started = await restartBundledGateway()
    if (started) {
      send('start', 'done', 'Gateway 已重启')
    } else {
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
