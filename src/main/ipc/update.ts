import type { IpcMain } from 'electron'
import { app } from 'electron'
import fs from 'fs'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import os from 'os'
import https from 'https'
import { spawn } from 'child_process'
import {
  stopGatewayGracefully,
  restartBundledGateway,
  getBundledOpenclawVersion,
  waitForPortClosed,
  getBundledNpmBin,
  getBundledGitBin,
  GATEWAY_PORT,
} from '../gateway/bundled-process'

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
    // 打包版：优先查 userData（解压目标），回退 resources（旧版兼容）
    ? [join(app.getPath('userData'), 'openclaw'), join(process.resourcesPath, 'openclaw')]
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

// ── 模块级升级状态（供渲染层挂载时查询，页面切换后恢复）──────────────────────────
const _upgradeStepNames = ['download', 'verify', 'stage', 'stop', 'install', 'start', 'rollback'] as const
type UpgradeStepStatus = 'pending' | 'running' | 'done' | 'error'

const _upgradeState: {
  running: boolean
  steps: Record<string, { status: UpgradeStepStatus; logs: string[] }>
} = { running: false, steps: {} }

for (const s of _upgradeStepNames) _upgradeState.steps[s] = { status: 'pending', logs: [] }

function resetUpgradeState(): void {
  _upgradeState.running = true
  for (const s of _upgradeStepNames) _upgradeState.steps[s] = { status: 'pending', logs: [] }
}

// ── 进度发送器类型 ─────────────────────────────────────────────────────────────
type ProgressSender = (step: string, status: 'running' | 'done' | 'error', detail?: string) => void

// ── Step 1: 下载 —— npm install openclaw@version（gateway 仍在运行）────────────
async function downloadOpenclaw(
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
  const nodeBin = dirname(npmBin)
  const baseArgs = ['install', '--no-audit', '--no-fund', '--ignore-scripts']

  const pathSep = process.platform === 'win32' ? ';' : ':'
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: `${nodeBin}${pathSep}${process.env.PATH ?? ''}`,
  }
  const bundledGit = getBundledGitBin()
  if (bundledGit) env.npm_config_git = bundledGit

  for (const registry of [REGISTRY, REGISTRY_FALLBACK]) {
    send('download', 'running', `正在从 ${registry} 下载 openclaw@${version}...`)
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
    send('download', 'running', `${registry} 失败，切换到下一个源...`)
  }
  return false
}

// ── Step 2: 验证下载结果 ───────────────────────────────────────────────────────
async function verifyDownload(wrapperDir: string, version: string): Promise<string | null> {
  const openclawSrc = join(wrapperDir, 'node_modules', 'openclaw')
  if (!existsSync(openclawSrc)) return '找不到 openclaw 包，npm install 结果异常'

  const pkgPath = join(openclawSrc, 'package.json')
  if (!existsSync(pkgPath)) return '找不到 openclaw/package.json'

  try {
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8')) as { version?: string }
    if (pkg.version !== version) return `版本不匹配：期望 ${version}，实际 ${pkg.version ?? '未知'}`
  } catch {
    return 'package.json 读取失败'
  }

  const entryFile = join(openclawSrc, 'openclaw.mjs')
  if (!existsSync(entryFile)) return '找不到 openclaw.mjs 入口文件'

  return null
}

// ── Step 3: 暂存新版本到 stagingDir（gateway 仍在运行）────────────────────────
// stagingDir 与 openclawDir 同盘，之后可以 rename 迁移（原子操作）
async function stageNewOpenclaw(
  wrapperDir: string, stagingDir: string, send: ProgressSender
): Promise<void> {
  const newOpenclawSrc = join(wrapperDir, 'node_modules', 'openclaw')
  const wrapperMods = join(wrapperDir, 'node_modules')

  send('stage', 'running', '正在复制源文件...')

  // 1. 复制 openclaw 源文件（不含 node_modules）
  const srcEntries = await fs.promises.readdir(newOpenclawSrc)
  await Promise.all(
    srcEntries
      .filter(e => e !== 'node_modules')
      .map(e => fs.promises.cp(join(newOpenclawSrc, e), join(stagingDir, e), { recursive: true }))
  )

  send('stage', 'running', '正在复制依赖...')

  // 2. 复制依赖到 stagingDir/node_modules（跳过 openclaw 自身和无用大包）
  const targetMods = join(stagingDir, 'node_modules')
  await fs.promises.mkdir(targetMods, { recursive: true })

  const modEntries = await fs.promises.readdir(wrapperMods)
  await Promise.all(
    modEntries
      .filter(e => e !== 'openclaw' && e !== '.package-lock.json')
      .filter(e => !UNUSED_LARGE_PKGS.includes(e))
      .map(e => fs.promises.cp(join(wrapperMods, e), join(targetMods, e), { recursive: true }))
  )

  // 3. 写入 easiest-claw-gateway.mjs
  await fs.promises.writeFile(join(stagingDir, 'easiest-claw-gateway.mjs'), EASIEST_CLAW_GATEWAY_SCRIPT)
}

// ── Step 5: 备份 + 迁移（原子 rename，gateway 已停止）────────────────────────
async function backupAndMigrate(
  openclawDir: string, stagingDir: string, backupDir: string, send: ProgressSender
): Promise<void> {
  send('install', 'running', '正在备份旧版本...')
  await fs.promises.rename(openclawDir, backupDir)

  send('install', 'running', '正在迁移新版本...')
  await fs.promises.rename(stagingDir, openclawDir)
}

// ── 回滚：恢复备份并重启旧 Gateway ───────────────────────────────────────────
async function rollback(
  openclawDir: string, backupDir: string, send: ProgressSender
): Promise<void> {
  send('rollback', 'running', '正在回滚...')
  try {
    if (existsSync(openclawDir)) {
      await fs.promises.rm(openclawDir, { recursive: true, force: true })
    }
    if (existsSync(backupDir)) {
      await fs.promises.rename(backupDir, openclawDir)
      send('rollback', 'done', '已恢复旧版本')
    } else {
      send('rollback', 'error', '备份不存在，无法回滚')
    }
  } catch (e) {
    send('rollback', 'error', `回滚失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ── 主升级函数 ─────────────────────────────────────────────────────────────────
async function performUpgrade(
  version: string, openclawDir: string, send: ProgressSender
): Promise<{ ok: boolean; error?: string }> {
  // tmpDir 用于 npm install，stagingDir 与 openclawDir 同盘（保证 rename 原子性）
  const tmpDir = join(os.tmpdir(), `openclaw-update-${Date.now()}`)
  const stagingDir = openclawDir + '.new'
  const backupDir = openclawDir + '.backup'
  const wrapperDir = join(tmpDir, 'wrapper')
  let gatewayWasStopped = false

  try {
    await fs.promises.mkdir(tmpDir, { recursive: true })
    await fs.promises.mkdir(wrapperDir, { recursive: true })
    await fs.promises.mkdir(stagingDir, { recursive: true })

    // 清理残留的上次备份/暂存目录
    if (existsSync(backupDir)) {
      await fs.promises.rm(backupDir, { recursive: true, force: true })
    }

    // ── Step 1: 下载（gateway 仍在运行，用户无感知）────────────────────────────
    send('download', 'running', `正在下载 openclaw@${version}...`)
    const downloadOk = await downloadOpenclaw(version, wrapperDir, send)
    if (!downloadOk) {
      send('download', 'error', '下载失败，请检查网络连接')
      return { ok: false, error: '下载失败' }
    }
    send('download', 'done', `openclaw@${version} 下载完成`)

    // ── Step 2: 验证 ────────────────────────────────────────────────────────────
    send('verify', 'running', '正在验证下载内容...')
    const verifyErr = await verifyDownload(wrapperDir, version)
    if (verifyErr) {
      send('verify', 'error', verifyErr)
      return { ok: false, error: verifyErr }
    }
    send('verify', 'done', '验证通过')

    // ── Step 3: 暂存（gateway 仍在运行）─────────────────────────────────────────
    send('stage', 'running', '正在准备新版本文件...')
    await stageNewOpenclaw(wrapperDir, stagingDir, send)
    send('stage', 'done', '新版本文件已就绪')

    // ── Step 4: 停止 gateway（SIGTERM → SIGKILL）─────────────────────────────
    send('stop', 'running', '正在停止 Gateway...')
    await stopGatewayGracefully(5_000)
    gatewayWasStopped = true

    const portClosed = await waitForPortClosed(GATEWAY_PORT, 15_000)
    if (!portClosed) {
      send('stop', 'error', 'Gateway 端口未在 15s 内释放，升级中止')
      // 尝试恢复 gateway（旧版本目录未动）
      try { await restartBundledGateway() } catch {}
      return { ok: false, error: 'Gateway 停止超时' }
    }
    send('stop', 'done', 'Gateway 已停止，端口已释放')

    // ── Step 5+6: 备份 + 迁移（原子 rename，最短停机时间）─────────────────────
    await backupAndMigrate(openclawDir, stagingDir, backupDir, send)
    send('install', 'done', '文件迁移完成')

    // ── Step 7: 启动新版本 ───────────────────────────────────────────────────
    send('start', 'running', '正在启动新版 Gateway...')
    const started = await restartBundledGateway()

    if (!started) {
      // ── 回滚 ────────────────────────────────────────────────────────────────
      send('start', 'error', '新版 Gateway 启动失败，正在回滚...')
      await rollback(openclawDir, backupDir, send)
      try { await restartBundledGateway() } catch {}
      return { ok: false, error: '新版 Gateway 启动失败，已回滚至旧版本' }
    }

    // ── Step 8: 清理备份 ────────────────────────────────────────────────────
    send('start', 'done', `升级完成，当前版本 ${version}`)
    fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => {})

    return { ok: true }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    send('install', 'error', `升级异常: ${msg}`)
    console.error('[Update] upgrade error:', err)

    if (gatewayWasStopped) {
      await rollback(openclawDir, backupDir, send)
      try { await restartBundledGateway() } catch {}
    }
    return { ok: false, error: msg }

  } finally {
    // 无论如何清理临时目录和残留暂存目录
    fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    if (existsSync(stagingDir)) {
      fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    }
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

  // 执行升级
  ipcMain.handle('openclaw:upgrade', async (event, { version }: { version: string }) => {
    resetUpgradeState()
    const send: ProgressSender = (step, status, detail) => {
      console.log(`[Update:${step}][${status}] ${detail ?? ''}`)
      // 同步更新模块级状态，供渲染层重新挂载时恢复
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
    const result = await performUpgrade(version, openclawDir, send)
    _upgradeState.running = false
    return result
  })

  // 查询当前升级状态（渲染层切换页面回来时初始化用）
  ipcMain.handle('openclaw:upgrade-state', () => _upgradeState)
}
