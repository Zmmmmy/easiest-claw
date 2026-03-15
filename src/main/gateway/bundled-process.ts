import { utilityProcess } from 'electron'
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
import {
  findOpenclawEntry,
  getBundledNodeBin as _getBundledNodeBin,
  getBundledNpmBin as _getBundledNpmBin,
  getBundledGitBin as _getBundledGitBin,
} from '../lib/openclaw-paths'

export const GATEWAY_PORT = 18789

export type GatewaySource = 'bundled' | 'external' | 'none'

let gatewaySource: GatewaySource = 'none'
let portConflictPending = false

export function getGatewaySource(): GatewaySource { return gatewaySource }
export function setGatewaySource(s: GatewaySource): void { gatewaySource = s }
export function isPortConflictPending(): boolean { return portConflictPending }
export function setPortConflictPending(v: boolean): void { portConflictPending = v }

// ── Path utilities（委托给 lib/openclaw-paths.ts）────────────────────────────────
// 保留导出名称以兼容现有调用方（update.ts 等）
export const getBundledOpenclaw = findOpenclawEntry
export const getBundledGitBin = _getBundledGitBin
export const getBundledNodeBin = _getBundledNodeBin
export const getBundledNpmBin = _getBundledNpmBin

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
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8')) as Record<string, unknown>
    currentVersion = typeof pkg.version === 'string' ? pkg.version : undefined
  } catch { return }

  // 版本标记文件：记录上次成功 npm install 时的 openclaw 版本
  const versionMarkPath = join(openclawDir, '.deps-installed-version')
  let installedVersion: string | null = null
  try { installedVersion = (await fs.promises.readFile(versionMarkPath, 'utf8')).trim() } catch {}

  if (installedVersion === currentVersion) return // 版本未变，跳过

  logger.info(`[AutoSpawn] openclaw version changed (${installedVersion ?? 'none'} -> ${currentVersion ?? '?'}), installing deps...`)
  console.log('[AutoSpawn] version changed, installing deps...')

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
        logger.info('[AutoSpawn] deps install done')
        console.log('[AutoSpawn] deps install done')
      } else {
        logger.warn(`[AutoSpawn] npm install exited code=${code}, continuing`)
      }
      resolve(code === 0)
    })
    child.on('error', (e) => {
      logger.warn(`[AutoSpawn] npm install failed: ${e.message}, continuing`)
      resolve(false)
    })
  })

  // 安装成功后写版本标记，下次启动同版本不再重跑
  if (ok && currentVersion) {
    try { await fs.promises.writeFile(versionMarkPath, currentVersion, 'utf8') } catch {}
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

/** 单次 TCP 探测：端口是否已打开（不轮询，仅一次连接尝试） */
export async function checkPortOnce(port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' })
    const timer = setTimeout(() => { socket.destroy(); resolve(false) }, timeoutMs)
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true) })
    socket.once('error', () => { clearTimeout(timer); socket.destroy(); resolve(false) })
  })
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

// 剥离 ANSI 颜色/控制转义码
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
function stripAnsi(str: string): string { return str.replace(ANSI_RE, '') }

// 日志缓冲区：保留最近 500 行，供渲染层挂载时初始化日志面板
const _gatewayLogBuffer: Array<{ line: string; isError: boolean }> = []
const GATEWAY_LOG_BUFFER_MAX = 500

export function addGatewayLogListener(fn: GatewayLogListener): () => void {
  gatewayLogListeners.add(fn)
  return () => gatewayLogListeners.delete(fn)
}

export function getGatewayLogBuffer(): Array<{ line: string; isError: boolean }> {
  return _gatewayLogBuffer.slice()
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

/**
 * 优雅停止 Gateway：先 SIGTERM，超时后 SIGKILL，返回后进程已不存在。
 * OpenClaw 不支持 shutdown RPC，只能通过进程信号停止。
 */
export async function stopGatewayGracefully(timeoutMs = 5000): Promise<void> {
  if (!gatewayProcess) return

  const child = gatewayProcess
  const pid = child.pid

  // 防止 exit 事件触发自动重启
  autoRestartCount = MAX_AUTO_RESTARTS

  await new Promise<void>((resolve) => {
    let exited = false

    const onExit = () => {
      exited = true
      clearTimeout(forceKillTimer)
      resolve()
    }
    child.once('exit', onExit)

    // Phase 1: SIGTERM / TerminateProcess（Electron utilityProcess.kill()）
    logger.info(`[Gateway] sending termination signal (pid=${pid ?? 'unknown'})`)
    try { child.kill() } catch {}

    // Phase 2: 超时后强制杀死
    const forceKillTimer = setTimeout(() => {
      if (!exited) {
        logger.warn(`[Gateway] not exited within ${timeoutMs}ms, force-killing (pid=${pid ?? 'unknown'})`)
        console.warn(`[Gateway] force-killing pid=${pid ?? 'unknown'}`)
        if (pid) {
          try {
            if (process.platform === 'win32') {
              // Windows: taskkill /F /T 终止进程树
              spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true })
                .on('error', () => {})
            } else {
              process.kill(pid, 'SIGKILL')
            }
          } catch {}
        }
        resolve()
      }
    }, timeoutMs)
  })

  gatewayProcess = null
}

export function forkOpenclawGateway(entryScript: string, openclawDir: string, token: string, force = false): void {
  if (gatewayProcess && !force) return
  if (gatewayProcess && force) {
    logger.info('[Gateway] force restart: killing old process...')
    console.log('[Gateway] force restart: killing old process...')
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
  logger.info(`[Gateway] fork done — entry: ${entryScript}`)

  const handleLine = (raw: string, isError: boolean) => {
    const line = stripAnsi(raw)
    _gatewayLogBuffer.push({ line, isError })
    if (_gatewayLogBuffer.length > GATEWAY_LOG_BUFFER_MAX) _gatewayLogBuffer.shift()
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
    // 如果 gatewayProcess 已被换成新进程（升级重启场景），忽略旧进程的 exit 事件
    if (gatewayProcess !== child) return

    logger.warn(`[Gateway] process exited code=${code}`)
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
      logger.info(`[Gateway] auto-restart in ${AUTO_RESTART_DELAY_MS / 1000}s (${autoRestartCount}/${MAX_AUTO_RESTARTS})...`)
      console.log(`[Gateway] auto-restart in ${AUTO_RESTART_DELAY_MS / 1000}s (${autoRestartCount}/${MAX_AUTO_RESTARTS})...`)
      setTimeout(() => {
        if (gatewayProcess !== null) return // 已被其他逻辑重启，跳过
        logger.info('[Gateway] auto-restarting...')
        forkOpenclawGateway(entryScript, openclawDir, token)
      }, AUTO_RESTART_DELAY_MS)
    } else {
      logger.warn(`[Gateway] max auto-restart reached (${MAX_AUTO_RESTARTS}), giving up`)
      console.warn(`[Gateway] max auto-restart reached (${MAX_AUTO_RESTARTS}), giving up`)
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
    logger.warn('[AutoSpawn] bundled openclaw not found, skipping')
    console.log('[AutoSpawn] bundled openclaw not found, skipping')
    return
  }

  const { openclawDir, entryScript } = bundledOc
  logger.info(`[AutoSpawn] bundled openclaw dir: ${openclawDir}`)

  let token = readGatewayToken()
  if (!token) {
    logger.info('[AutoSpawn] first run, generating token...')
    console.log('[AutoSpawn] first run, generating token...')
    token = crypto.randomBytes(24).toString('hex')
    writeGatewayConfig(token)
    logger.info('[AutoSpawn] config written')
    console.log('[AutoSpawn] config written')
  } else {
    writeGatewayConfig(token)
  }

  sanitizeOpenClawConfig()
  patchSettings({ gateway: { url: `ws://localhost:${GATEWAY_PORT}`, token } })

  logger.info('[AutoSpawn] probing port 18789...')
  const alreadyUp = await checkPortOnce(GATEWAY_PORT, 300)
  if (alreadyUp) {
    if (gatewayProcess !== null) {
      logger.info('[AutoSpawn] bundled gateway already running, skip fork')
      console.log('[AutoSpawn] bundled gateway already running, skip fork')
      gatewaySource = 'bundled'
    } else {
      logger.warn('[AutoSpawn] port 18789 occupied by external process, awaiting user decision...')
      console.log('[AutoSpawn] port 18789 occupied by external process, awaiting user decision...')
      portConflictPending = true
    }
    return
  }

  logger.info('[AutoSpawn] forking bundled OpenClaw Gateway...')
  console.log('[AutoSpawn] forking bundled OpenClaw Gateway...')

  // fork 前先确保依赖完整（修复程序内升级后 node_modules 未补全的问题）
  await ensureOpenclawDependencies(openclawDir)

  forkOpenclawGateway(entryScript, openclawDir, token)

  logger.info('[AutoSpawn] waiting for gateway ready (max 90s)...')
  const ready = await waitForGatewayReady(90_000)
  if (ready) {
    gatewaySource = 'bundled'
    logger.info('[AutoSpawn] bundled gateway ready')
    console.log('[AutoSpawn] bundled gateway ready')
  } else {
    logger.warn('[AutoSpawn] bundled gateway not ready within 90s, continuing (adapter will retry)')
    console.warn('[AutoSpawn] bundled gateway not ready within 90s, continuing')
  }
}

export async function restartBundledGateway(): Promise<boolean> {
  const bundledOc = getBundledOpenclaw()
  if (!bundledOc) {
    logger.warn('[RestartBundled] bundled openclaw dir not found')
    console.warn('[RestartBundled] bundled openclaw dir not found')
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
    logger.info('[RestartBundled] gateway ready')
    console.log('[RestartBundled] gateway ready')
  } else {
    logger.warn('[RestartBundled] gateway not ready within 90s')
    console.warn('[RestartBundled] gateway not ready within 90s')
  }
  return ready
}
