import { app, utilityProcess } from 'electron'
import os from 'os'
import fs from 'fs'
import crypto from 'crypto'
import net from 'net'
import { existsSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { patchSettings } from './settings'
import { sanitizeOpenClawConfig } from '../openclaw-init'
import { getOpenclawConfigPath } from '../lib/openclaw-config'
import { logger } from '../lib/logger'

export const GATEWAY_PORT = 18789

export type GatewaySource = 'bundled' | 'external' | 'none'

let gatewaySource: GatewaySource = 'none'
let portConflictPending = false

export function getGatewaySource(): GatewaySource { return gatewaySource }
export function setGatewaySource(s: GatewaySource): void { gatewaySource = s }
export function isPortConflictPending(): boolean { return portConflictPending }
export function setPortConflictPending(v: boolean): void { portConflictPending = v }

// ── Path utilities ─────────────────────────────────────────────────────────────
export function getBundledOpenclaw(): { openclawDir: string; entryScript: string } | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'openclaw')]
    : [join(app.getAppPath(), 'build', 'openclaw')]

  for (const openclawDir of candidates) {
    const wrapper = join(openclawDir, 'easiest-claw-gateway.mjs')
    const entryScript = existsSync(wrapper) ? wrapper : join(openclawDir, 'openclaw.mjs')
    if (existsSync(entryScript)) return { openclawDir, entryScript }
  }
  return null
}

export function getBundledGitBin(): string | null {
  if (process.platform !== 'win32') return null
  const gitDir = app.isPackaged
    ? join(process.resourcesPath, 'git')
    : join(app.getAppPath(), 'resources', 'git', 'win')
  const gitExe = join(gitDir, 'cmd', 'git.exe')
  return existsSync(gitExe) ? gitExe : null
}

export function getBundledNodeBin(): string {
  const nodeDir = app.isPackaged
    ? join(process.resourcesPath, 'node')
    : join(app.getAppPath(), 'resources', 'node')
  return process.platform === 'win32'
    ? join(nodeDir, 'node.exe')
    : join(nodeDir, 'node')
}

export function getBundledNpmBin(): string {
  const nodeDir = app.isPackaged
    ? join(process.resourcesPath, 'node')
    : join(app.getAppPath(), 'resources', 'node')
  return process.platform === 'win32'
    ? join(nodeDir, 'npm.cmd')
    : join(nodeDir, 'npm')
}

/**
 * 确保 openclaw 的依赖已安装。版本感知：openclaw 版本变化（如 in-app 升级后）就重新安装。
 * 修复"程序内升级后 node_modules 未补全"导致的 ERR_MODULE_NOT_FOUND。
 * --omit=optional/peer 跳过 libsignal 等 git URL 依赖（已作为 stub 存在）。
 */
export async function ensureOpenclawDependencies(openclawDir: string): Promise<void> {
  const pkgPath = join(openclawDir, 'package.json')
  if (!existsSync(pkgPath)) return

  let currentVersion: string | undefined
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
    currentVersion = typeof pkg.version === 'string' ? pkg.version : undefined
  } catch { return }

  // 版本标记文件：记录上次成功 npm install 时的 openclaw 版本
  const versionMarkPath = join(openclawDir, '.deps-installed-version')
  let installedVersion: string | null = null
  try { installedVersion = fs.readFileSync(versionMarkPath, 'utf8').trim() } catch {}

  if (installedVersion === currentVersion) return // 版本未变，跳过

  logger.info(`[AutoSpawn] openclaw 版本变化（${installedVersion ?? '无'} → ${currentVersion ?? '?'}），正在补全依赖...`)
  console.log(`[AutoSpawn] openclaw 版本变化，正在补全依赖...`)

  const npmBin = getBundledNpmBin()
  const nodeDir = join(npmBin, '..')
  const args = ['install', '--omit=optional', '--omit=peer', '--omit=dev', '--ignore-scripts', '--prefer-offline']

  const ok = await new Promise<boolean>((resolve) => {
    const child = spawn(npmBin, args, {
      cwd: openclawDir,
      windowsHide: true,
      shell: process.platform === 'win32',
      env: { ...process.env, PATH: `${nodeDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (d: Buffer) => logger.info(`[npm] ${d.toString().trim()}`))
    child.stderr?.on('data', (d: Buffer) => logger.warn(`[npm] ${d.toString().trim()}`))
    child.on('close', (code) => {
      if (code === 0) {
        logger.info('[AutoSpawn] 依赖补全完成')
        console.log('[AutoSpawn] 依赖补全完成')
      } else {
        logger.warn(`[AutoSpawn] npm install 退出 code=${code}，继续启动`)
      }
      resolve(code === 0)
    })
    child.on('error', (e) => {
      logger.warn(`[AutoSpawn] npm install 失败: ${e.message}，继续启动`)
      resolve(false)
    })
  })

  // 安装成功后写版本标记，下次启动同版本不再重跑
  if (ok && currentVersion) {
    try { fs.writeFileSync(versionMarkPath, currentVersion, 'utf8') } catch {}
  }
}

// ── Gateway config ─────────────────────────────────────────────────────────────
export function readGatewayToken(): string | null {
  try {
    const configPath = getOpenclawConfigPath()
    if (!existsSync(configPath)) return null
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
    const auth = ((parsed.gateway as Record<string, unknown>)?.auth) as Record<string, unknown> | undefined
    const token = auth?.token
    return typeof token === 'string' && token.trim() ? token.trim() : null
  } catch {
    return null
  }
}

export function readGatewayPort(): number {
  try {
    const configPath = getOpenclawConfigPath()
    if (!existsSync(configPath)) return GATEWAY_PORT
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
    const port = ((parsed.gateway as Record<string, unknown>)?.port) as number | undefined
    return typeof port === 'number' && port > 0 ? port : GATEWAY_PORT
  } catch {
    return GATEWAY_PORT
  }
}

export function writeGatewayConfig(token: string): void {
  const configPath = getOpenclawConfigPath()
  const configDir = join(os.homedir(), '.openclaw')

  if (!existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  let config: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
    } catch { /* start fresh */ }
  }

  const existingGateway = (config.gateway as Record<string, unknown>) ?? {}
  config.gateway = {
    ...existingGateway,
    port: GATEWAY_PORT,
    bind: 'loopback',
    mode: 'local',
    auth: { mode: 'token', token },
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
}

// ── TCP port probing ────────────────────────────────────────────────────────────
export async function waitForPortClosed(port: number, maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
      socket.setTimeout(800, () => { socket.destroy(); resolve(false) })
    })
    if (!open) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

export async function checkPortOpen(port: number, maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
      socket.setTimeout(800, () => { socket.destroy(); resolve(false) })
    })
    if (open) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

export async function waitForGatewayReady(maxMs: number): Promise<boolean> {
  return checkPortOpen(GATEWAY_PORT, maxMs)
}

// ── Bundled openclaw version ────────────────────────────────────────────────────
export async function getBundledOpenclawVersion(openclawDir: string): Promise<string | null> {
  try {
    const pkgPath = join(openclawDir, 'package.json')
    const content = await fs.promises.readFile(pkgPath, 'utf8')
    const pkg = JSON.parse(content)
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

// ── Gateway process ─────────────────────────────────────────────────────────────
type GatewayLogListener = (line: string, isError: boolean) => void
const gatewayLogListeners = new Set<GatewayLogListener>()

export function addGatewayLogListener(fn: GatewayLogListener): () => void {
  gatewayLogListeners.add(fn)
  return () => gatewayLogListeners.delete(fn)
}

let gatewayProcess: Electron.UtilityProcess | null = null

// 自动重启状态
let autoRestartCount = 0
let lastAutoRestartTime = 0
const MAX_AUTO_RESTARTS = 5
const AUTO_RESTART_DELAY_MS = 3_000
const AUTO_RESTART_RESET_INTERVAL_MS = 5 * 60 * 1000 // 5分钟内无重启则重置计数器

export function isBundledGatewayActive(): boolean {
  return gatewayProcess !== null
}

export function stopGatewayProcess(): void {
  if (gatewayProcess) {
    // 主动停止：重置自动重启计数，防止 exit 事件触发自动重启
    autoRestartCount = MAX_AUTO_RESTARTS
    try { gatewayProcess.kill() } catch {}
    gatewayProcess = null
  }
}

export function forkOpenclawGateway(entryScript: string, openclawDir: string, token: string, force = false): void {
  if (gatewayProcess && !force) return
  if (gatewayProcess && force) {
    logger.info('[Gateway] 强制重启：终止旧进程...')
    console.log('[Gateway] 强制重启：终止旧进程...')
    try { gatewayProcess.kill() } catch {}
    gatewayProcess = null
  }

  const child = utilityProcess.fork(
    entryScript,
    ['gateway', '--port', String(GATEWAY_PORT), '--token', token, '--allow-unconfigured'],
    {
      cwd: openclawDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        OPENCLAW_GATEWAY_TOKEN: token,
        OPENCLAW_NO_RESPAWN: '1',
        OPENCLAW_ALLOW_MULTI_GATEWAY: '1',
      },
      serviceName: 'OpenClaw Gateway',
    }
  )
  logger.info(`[Gateway] fork 完成 — entry: ${entryScript}`)

  const handleLine = (line: string, isError: boolean) => {
    console.log(`[Gateway${isError ? ':err' : ''}]`, line)
    gatewayLogListeners.forEach(fn => fn(line, isError))
  }
  const splitLines = (data: Buffer, isError: boolean) => {
    for (const line of data.toString().split('\n')) {
      if (line.trim()) handleLine(line.trim(), isError)
    }
  }
  child.stdout?.on('data', (d: Buffer) => splitLines(d, false))
  child.stderr?.on('data', (d: Buffer) => splitLines(d, true))
  child.on('exit', (code) => {
    logger.warn(`[Gateway] 进程退出 code=${code}`)
    console.log(`[Gateway] process exited (code=${code})`)
    gatewayProcess = null

    // 自动重启：非主动 kill（gatewayProcess 已被设为 null 表示主动停止）时自动重启
    const now = Date.now()
    if (now - lastAutoRestartTime > AUTO_RESTART_RESET_INTERVAL_MS) {
      autoRestartCount = 0
    }
    if (autoRestartCount < MAX_AUTO_RESTARTS) {
      autoRestartCount++
      lastAutoRestartTime = now
      logger.info(`[Gateway] 将在 ${AUTO_RESTART_DELAY_MS / 1000}s 后自动重启 (${autoRestartCount}/${MAX_AUTO_RESTARTS})...`)
      console.log(`[Gateway] 将在 ${AUTO_RESTART_DELAY_MS / 1000}s 后自动重启 (${autoRestartCount}/${MAX_AUTO_RESTARTS})...`)
      setTimeout(() => {
        if (gatewayProcess !== null) return // 已被其他逻辑重启，跳过
        logger.info(`[Gateway] 自动重启中...`)
        forkOpenclawGateway(entryScript, openclawDir, token)
      }, AUTO_RESTART_DELAY_MS)
    } else {
      logger.warn(`[Gateway] 已达最大自动重启次数 (${MAX_AUTO_RESTARTS})，停止自动重启`)
      console.warn(`[Gateway] 已达最大自动重启次数 (${MAX_AUTO_RESTARTS})，停止自动重启`)
    }
  })

  gatewayProcess = child
}

// ── System gateway (via openclaw CLI) ─────────────────────────────────────────
export async function stopSystemGateway(): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('openclaw', ['gateway', 'stop'], {
      shell: process.platform === 'win32',
      windowsHide: true,
    })
    child.on('close', () => resolve())
    child.on('error', () => resolve())
    setTimeout(() => { try { child.kill() } catch {} resolve() }, 5000)
  })
}

export async function restartSystemGateway(): Promise<boolean> {
  const port = readGatewayPort()
  const token = readGatewayToken()
  if (!token) return false

  const child = spawn('openclaw', ['gateway', '--port', String(port), '--token', token, '--allow-unconfigured'], {
    shell: process.platform === 'win32',
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
  })
  try { child.unref() } catch {}
  return checkPortOpen(port, 20_000)
}

// ── Auto-spawn & restart bundled openclaw ──────────────────────────────────────
export async function autoSpawnBundledOpenclaw(): Promise<void> {
  const bundledOc = getBundledOpenclaw()
  if (!bundledOc) {
    logger.warn('[AutoSpawn] 内置 openclaw 不存在，跳过')
    console.log('[AutoSpawn] 内置 openclaw 不存在，跳过')
    return
  }

  const { openclawDir, entryScript } = bundledOc
  logger.info(`[AutoSpawn] 内置 openclaw 目录: ${openclawDir}`)

  let token = readGatewayToken()
  if (!token) {
    logger.info('[AutoSpawn] 首次启动，生成 token 并写入配置...')
    console.log('[AutoSpawn] 首次启动，生成 token 并写入配置...')
    token = crypto.randomBytes(24).toString('hex')
    writeGatewayConfig(token)
    logger.info('[AutoSpawn] 配置写入完成')
    console.log('[AutoSpawn] 配置写入完成')
  } else {
    writeGatewayConfig(token)
  }

  sanitizeOpenClawConfig()
  patchSettings({ gateway: { url: `ws://localhost:${GATEWAY_PORT}`, token } })

  logger.info('[AutoSpawn] 检查端口 18789 是否已就绪...')
  const alreadyUp = await waitForGatewayReady(1500)
  if (alreadyUp) {
    if (gatewayProcess !== null) {
      logger.info('[AutoSpawn] 内置 Gateway 已在运行，跳过 fork')
      console.log('[AutoSpawn] 内置 Gateway 已在运行，跳过 fork')
      gatewaySource = 'bundled'
    } else {
      logger.warn('[AutoSpawn] 端口 18789 已被外部进程占用，等待用户决策...')
      console.log('[AutoSpawn] 端口 18789 已被外部进程占用，等待用户决策...')
      portConflictPending = true
    }
    return
  }

  logger.info('[AutoSpawn] 正在 fork 内置 OpenClaw Gateway...')
  console.log('[AutoSpawn] 正在 fork 内置 OpenClaw Gateway...')

  // fork 前先确保依赖完整（修复程序内升级后 node_modules 未补全的问题）
  await ensureOpenclawDependencies(openclawDir)

  forkOpenclawGateway(entryScript, openclawDir, token)

  logger.info('[AutoSpawn] 等待 Gateway 就绪（最长 90s）...')
  const ready = await waitForGatewayReady(90_000)
  if (ready) {
    gatewaySource = 'bundled'
    logger.info('[AutoSpawn] 内置 Gateway 已就绪')
    console.log('[AutoSpawn] 内置 Gateway 已就绪')
  } else {
    logger.warn('[AutoSpawn] 内置 Gateway 90s 内未就绪，继续（连接层将自动重试）')
    console.warn('[AutoSpawn] 内置 Gateway 90s 内未就绪，继续（连接层将自动重试）')
  }
}

export async function restartBundledGateway(): Promise<boolean> {
  const bundledOc = getBundledOpenclaw()
  if (!bundledOc) {
    logger.warn('[RestartBundled] 找不到内置 openclaw 目录')
    console.warn('[RestartBundled] 找不到内置 openclaw 目录')
    return false
  }
  const { openclawDir, entryScript } = bundledOc

  let token = readGatewayToken()
  if (!token) {
    token = crypto.randomBytes(24).toString('hex')
    writeGatewayConfig(token)
  }

  patchSettings({ gateway: { url: `ws://localhost:${GATEWAY_PORT}`, token } })
  // 升级后重启：先重置自动重启计数，避免旧的 exit 事件干扰
  autoRestartCount = 0
  forkOpenclawGateway(entryScript, openclawDir, token, true)

  const ready = await waitForGatewayReady(90_000)
  if (ready) {
    logger.info('[RestartBundled] Gateway 已就绪')
    console.log('[RestartBundled] Gateway 已就绪')
  } else {
    logger.warn('[RestartBundled] Gateway 90s 内未就绪')
    console.warn('[RestartBundled] Gateway 90s 内未就绪')
  }
  return ready
}
