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

function pushGatewayDiag(message: string, isError = false): void {
  const line = `[诊断] ${message}`
  pushGatewayLog(line, isError)
  if (isError) logger.warn(`[GatewayDiag] ${message}`)
  else logger.info(`[GatewayDiag] ${message}`)
}

// ── Path utilities（委托给 lib/openclaw-paths.ts）────────────────────────────────
// 保留导出名称以兼容现有调用方（update.ts 等）
export const getBundledOpenclaw = findOpenclawEntry
export const getBundledGitBin = _getBundledGitBin
export const getBundledNodeBin = _getBundledNodeBin
export const getBundledNpmBin = _getBundledNpmBin

/**
 * 确保 openclaw 的依赖已就绪。
 *
 * 打包好的 zip 解压后已包含完整的 node_modules（含正确版本的 @mariozechner/* 等），
 * 此时只需写入版本标记即可，**不应**运行 npm install（会按 package.json 声明的版本
 * 重新安装依赖，可能覆盖掉 bundle 时精心匹配的版本，导致 SyntaxError）。
 *
 * 仅当 node_modules 目录不存在或为空时（极端边界情况）才回退执行 npm install。
 */
export async function ensureOpenclawDependencies(openclawDir: string): Promise<void> {
  const depsStartAt = Date.now()
  const pkgPath = join(openclawDir, 'package.json')
  if (!existsSync(pkgPath)) {
    pushGatewayDiag(`依赖检查跳过：未找到 package.json (${pkgPath})`, true)
    return
  }

  let currentVersion: string | undefined
  try {
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8')) as Record<string, unknown>
    currentVersion = typeof pkg.version === 'string' ? pkg.version : undefined
  } catch {
    pushGatewayDiag(`依赖检查失败：读取 package.json 失败 (${pkgPath})`, true)
    return
  }

  // 版本标记文件：记录上次依赖就绪时的 openclaw 版本
  const versionMarkPath = join(openclawDir, '.deps-installed-version')
  let installedVersion: string | null = null
  try { installedVersion = (await fs.promises.readFile(versionMarkPath, 'utf8')).trim() } catch {}

  if (installedVersion === currentVersion) {
    pushGatewayDiag(`依赖已就绪：版本 ${currentVersion ?? 'unknown'}，耗时 ${Date.now() - depsStartAt}ms`)
    return
  }

  // 检查 node_modules 是否已存在且非空（zip 解压提供）
  const nodeModulesDir = join(openclawDir, 'node_modules')
  let nodeModulesReady = false
  try {
    const entries = await fs.promises.readdir(nodeModulesDir)
    nodeModulesReady = entries.length > 0
  } catch { /* 目录不存在 */ }

  if (nodeModulesReady) {
    // zip 解压已提供完整依赖，直接写版本标记，跳过 npm install
    logger.info(`[AutoSpawn] node_modules already present (zip-extracted), marking version ${currentVersion ?? '?'}`)
    pushGatewayDiag(`依赖目录已存在，跳过安装（version ${installedVersion ?? 'none'} -> ${currentVersion ?? 'unknown'}）`)
    if (currentVersion) {
      try { await fs.promises.writeFile(versionMarkPath, currentVersion, 'utf8') } catch {}
    }
    pushGatewayDiag(`依赖检查完成，耗时 ${Date.now() - depsStartAt}ms`)
    return
  }

  // node_modules 不存在或为空 — 回退执行 npm install
  logger.info(`[AutoSpawn] node_modules missing, installing deps (${installedVersion ?? 'none'} -> ${currentVersion ?? '?'})...`)
  console.log('[AutoSpawn] node_modules missing, installing deps...')
  pushGatewayDiag(`依赖缺失，开始安装（${installedVersion ?? 'none'} -> ${currentVersion ?? 'unknown'}）`)

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
        pushGatewayDiag(`依赖安装成功，耗时 ${Date.now() - depsStartAt}ms`)
      } else {
        logger.warn(`[AutoSpawn] npm install exited code=${code}, continuing`)
        pushGatewayDiag(`依赖安装退出码=${code}，继续启动（耗时 ${Date.now() - depsStartAt}ms）`, true)
      }
      resolve(code === 0)
    })
    child.on('error', (e) => {
      logger.warn(`[AutoSpawn] npm install failed: ${e.message}, continuing`)
      pushGatewayDiag(`依赖安装异常：${e.message}，继续启动`, true)
      resolve(false)
    })
  })

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

function getRecentGatewayErrors(limit = 5): string[] {
  return _gatewayLogBuffer
    .filter(l => l.isError && l.line.trim())
    .slice(-limit)
    .map(l => l.line.trim())
}

export function addGatewayLogListener(fn: GatewayLogListener): () => void {
  gatewayLogListeners.add(fn)
  return () => gatewayLogListeners.delete(fn)
}

export function getGatewayLogBuffer(): Array<{ line: string; isError: boolean }> {
  return _gatewayLogBuffer.slice()
}

/** 主动推送一条日志到渲染层（复用 gateway log 通道），用于启动阶段可视化 */
export function pushGatewayLog(line: string, isError = false): void {
  _gatewayLogBuffer.push({ line, isError })
  if (_gatewayLogBuffer.length > GATEWAY_LOG_BUFFER_MAX) _gatewayLogBuffer.shift()
  gatewayLogListeners.forEach(fn => fn(line, isError))
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
    let settled = false

    const onExit = () => {
      if (settled) return
      settled = true
      clearTimeout(forceKillTimer)
      resolve()
    }
    child.once('exit', onExit)

    // Phase 1: SIGTERM / TerminateProcess（Electron utilityProcess.kill()）
    logger.info(`[Gateway] sending termination signal (pid=${pid ?? 'unknown'})`)
    try { child.kill() } catch {}

    // Phase 2: 超时后强制杀死
    const forceKillTimer = setTimeout(() => {
      if (settled) return
      settled = true
      child.removeListener('exit', onExit)
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
  logger.info(`[Gateway] fork done - pid=${child.pid ?? 'unknown'} entry=${entryScript}`)
  pushGatewayDiag(`Gateway 进程已创建 pid=${child.pid ?? 'unknown'}，entry=${entryScript}`)

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
  ;(child as unknown as NodeJS.EventEmitter).on('exit', (code: number | null, signal: string | null) => {
    // 如果 gatewayProcess 已被换成新进程（升级重启场景），忽略旧进程的 exit 事件
    if (gatewayProcess !== child) return

    logger.warn(`[Gateway] process exited code=${code} signal=${signal ?? 'none'}`)
    console.log(`[Gateway] process exited (code=${code}, signal=${signal ?? 'none'})`)
    pushGatewayDiag(
      `Gateway 进程退出 code=${code ?? 'null'} signal=${signal ?? 'none'} autoRestartCount=${autoRestartCount}/${MAX_AUTO_RESTARTS}`,
      code !== 0
    )
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
      pushGatewayDiag(`Gateway 将在 ${AUTO_RESTART_DELAY_MS / 1000}s 后自动重启（${autoRestartCount}/${MAX_AUTO_RESTARTS}）`)
      setTimeout(() => {
        if (gatewayProcess !== null) return // 已被其他逻辑重启，跳过
        logger.info('[Gateway] auto-restarting...')
        pushGatewayDiag('正在执行 Gateway 自动重启...')
        forkOpenclawGateway(entryScript, openclawDir, token)
      }, AUTO_RESTART_DELAY_MS)
    } else {
      logger.warn(`[Gateway] max auto-restart reached (${MAX_AUTO_RESTARTS}), giving up`)
      console.warn(`[Gateway] max auto-restart reached (${MAX_AUTO_RESTARTS}), giving up`)
      pushGatewayDiag(`Gateway 自动重启已达上限（${MAX_AUTO_RESTARTS}），停止重启`, true)
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
  const spawnStartedAt = Date.now()
  const bundledOc = getBundledOpenclaw()
  if (!bundledOc) {
    logger.warn('[AutoSpawn] bundled openclaw not found, skipping')
    console.log('[AutoSpawn] bundled openclaw not found, skipping')
    pushGatewayLog('[启动] 未找到内置 OpenClaw，跳过')
    return
  }

  const { openclawDir, entryScript } = bundledOc
  logger.info(`[AutoSpawn] bundled openclaw dir: ${openclawDir}`)
  const configPath = getOpenclawConfigPath()
  pushGatewayDiag(`OpenClaw 路径：${openclawDir}`)
  pushGatewayDiag(`Gateway 配置文件：${configPath}`)
  pushGatewayLog('[启动] 正在读取 Gateway 配置...')

  let token = readGatewayToken()
  if (!token) {
    logger.info('[AutoSpawn] first run, generating token...')
    console.log('[AutoSpawn] first run, generating token...')
    token = crypto.randomBytes(24).toString('hex')
    writeGatewayConfig(token)
    logger.info('[AutoSpawn] config written')
    console.log('[AutoSpawn] config written')
    pushGatewayLog('[启动] 首次运行，已生成 Gateway Token')
    pushGatewayDiag('首次启动：已生成新的 Gateway Token')
  } else {
    writeGatewayConfig(token)
    pushGatewayDiag('已读取并刷新现有 Gateway Token')
  }

  sanitizeOpenClawConfig()
  patchSettings({ gateway: { url: `ws://localhost:${GATEWAY_PORT}`, token } })

  pushGatewayLog('[启动] 正在检测端口 18789...')
  logger.info('[AutoSpawn] probing port 18789...')
  const alreadyUp = await checkPortOnce(GATEWAY_PORT, 300)
  pushGatewayDiag(`端口探测结果：port=${GATEWAY_PORT} open=${alreadyUp}`)
  if (alreadyUp) {
    if (gatewayProcess !== null) {
      logger.info('[AutoSpawn] bundled gateway already running, skip fork')
      console.log('[AutoSpawn] bundled gateway already running, skip fork')
      pushGatewayLog('[启动] Gateway 已在运行中')
      gatewaySource = 'bundled'
      pushGatewayDiag('检测到内置 Gateway 已在运行，跳过重新启动')
    } else {
      logger.warn('[AutoSpawn] port 18789 occupied by external process, awaiting user decision...')
      console.log('[AutoSpawn] port 18789 occupied by external process, awaiting user decision...')
      pushGatewayLog('[启动] 端口 18789 被外部进程占用，等待用户决定...')
      portConflictPending = true
      pushGatewayDiag(`端口 ${GATEWAY_PORT} 被外部进程占用，等待用户处理`, true)
    }
    return
  }

  pushGatewayLog('[启动] 正在启动 OpenClaw Gateway 进程...')
  logger.info('[AutoSpawn] forking bundled OpenClaw Gateway...')
  console.log('[AutoSpawn] forking bundled OpenClaw Gateway...')

  // fork 前先确保依赖完整（修复程序内升级后 node_modules 未补全的问题）
  pushGatewayLog('[启动] 检查 OpenClaw 依赖...')
  const depsCheckStartAt = Date.now()
  await ensureOpenclawDependencies(openclawDir)
  pushGatewayDiag(`依赖检查阶段结束，耗时 ${Date.now() - depsCheckStartAt}ms`)

  forkOpenclawGateway(entryScript, openclawDir, token)
  pushGatewayDiag(`已发起 Gateway fork，请求启动耗时 ${Date.now() - spawnStartedAt}ms`)

  pushGatewayLog('[启动] Gateway 进程已启动，等待就绪（最多 15 秒）...')
  logger.info('[AutoSpawn] waiting for gateway ready (max 15s)...')
  const waitStartedAt = Date.now()
  const ready = await waitForGatewayReady(15_000)
  const waitElapsed = Date.now() - waitStartedAt
  if (ready) {
    gatewaySource = 'bundled'
    logger.info('[AutoSpawn] bundled gateway ready')
    console.log('[AutoSpawn] bundled gateway ready')
    pushGatewayDiag(`Gateway 端口已就绪，等待耗时 ${waitElapsed}ms，总耗时 ${Date.now() - spawnStartedAt}ms`)
    pushGatewayLog('[启动] Gateway 已就绪 ✓')
  } else {
    // Don't block startup — adapter will auto-reconnect in the background
    gatewaySource = 'bundled'
    logger.warn('[AutoSpawn] bundled gateway not ready within 15s, adapter will retry in background')
    console.warn('[AutoSpawn] bundled gateway not ready within 15s, continuing')
    const portOpenAfterTimeout = await checkPortOnce(GATEWAY_PORT, 500)
    pushGatewayDiag(`15s 等待超时：port=${GATEWAY_PORT} open=${portOpenAfterTimeout}，改为后台重连`, true)
    const recentErrors = getRecentGatewayErrors(3)
    if (recentErrors.length > 0) {
      pushGatewayDiag(`最近 stderr: ${recentErrors.join(' | ')}`, true)
    }
    pushGatewayLog('[启动] Gateway 仍在初始化，已在后台继续连接...')
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

  // 同时等端口就绪和进程退出——如果进程提前崩溃不必等 90s
  const proc = gatewayProcess
  const ready = await Promise.race([
    waitForGatewayReady(90_000),
    // 进程提前退出 → 立即判定失败
    ...(proc ? [new Promise<false>((resolve) => {
      proc.once('exit', (code) => {
        logger.warn(`[RestartBundled] process exited early, code=${code}`)
        // 收集最近的 stderr 日志帮助诊断
        const recentErrors = _gatewayLogBuffer
          .filter(l => l.isError)
          .slice(-5)
          .map(l => l.line)
          .join('\n')
        if (recentErrors) {
          logger.error(`[RestartBundled] recent stderr:\n${recentErrors}`)
        }
        resolve(false)
      })
    })] : []),
  ])
  if (ready) {
    logger.info('[RestartBundled] gateway ready')
    console.log('[RestartBundled] gateway ready')
  } else {
    logger.warn('[RestartBundled] gateway not ready (exited early or 90s timeout)')
    console.warn('[RestartBundled] gateway not ready')
  }
  return ready
}
