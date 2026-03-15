import type { IpcMain } from 'electron'
import os from 'os'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { getRuntime, restartRuntime } from '../gateway/runtime'
import { patchSettings } from '../gateway/settings'
import {
  GATEWAY_PORT,
  getBundledOpenclaw,
  getBundledNodeBin,
  readGatewayToken,
  writeGatewayConfig,
  forkOpenclawGateway,
  waitForGatewayReady,
  checkPortOpen,
  waitForPortClosed,
  addGatewayLogListener,
  getBundledOpenclawVersion,
  getGatewaySource,
  setGatewaySource,
  isPortConflictPending,
  setPortConflictPending,
} from '../gateway/bundled-process'

// ── System environment detection ───────────────────────────────────────────────
async function getExecutablePath(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const child = spawn(isWin ? 'where' : 'which', [cmd], { windowsHide: true })
    let out = ''
    child.stdout?.on('data', (d: Buffer) => { out += d.toString() })
    child.on('close', (code) => {
      if (code === 0 && out.trim()) {
        // where 可能返回多行，取第一行
        resolve(out.trim().split(/\r?\n/)[0].trim())
      } else {
        resolve(null)
      }
    })
    child.on('error', () => resolve(null))
    const timer = setTimeout(() => { try { child.kill() } catch {} resolve(null) }, 3000)
    child.on('close', () => clearTimeout(timer))
  })
}

async function detectSystemNode(): Promise<{ version: string; path: string | null } | null> {
  const [version, execPath] = await Promise.all([
    new Promise<string | null>((resolve) => {
      const child = spawn('node', ['--version'], {
        shell: process.platform === 'win32',
        windowsHide: true,
      })
      let out = ''
      child.stdout?.on('data', (d: Buffer) => { out += d.toString() })
      child.on('close', (code) => resolve(code === 0 && out.trim() ? out.trim() : null))
      child.on('error', () => resolve(null))
      const timer = setTimeout(() => { try { child.kill() } catch {} resolve(null) }, 5000)
      child.on('close', () => clearTimeout(timer))
    }),
    getExecutablePath('node'),
  ])
  if (version === null) return null
  return { version, path: execPath }
}

// ── IPC handlers ───────────────────────────────────────────────────────────────
export const registerEnvHandlers = (ipcMain: IpcMain): void => {

  // ── 环境检测（并发执行，较慢但信息全面）──────────────────────────────────────
  ipcMain.handle('env:detect', async () => {
    const platform = os.platform()
    const osNames: Record<string, string> = {
      win32: 'Windows', darwin: 'macOS', linux: 'Linux',
    }

    const bundledOc = getBundledOpenclaw()
    const [systemNode, bundledOcVersion] = await Promise.all([
      detectSystemNode(),
      bundledOc ? getBundledOpenclawVersion(bundledOc.openclawDir) : Promise.resolve(undefined as string | null | undefined),
    ])

    const bundledNodeVersion = process.versions.node
    const adapter = getRuntime()
    const openclawRunning = adapter?.getStatus() === 'connected'

    const nodeActiveSource = 'bundled' as const
    const nodeActiveReason = `使用内置 Electron Node.js ${bundledNodeVersion}`

    const gatewaySource = getGatewaySource()
    const portConflictPending = isPortConflictPending()

    let ocActiveSource: 'bundled' | 'external'
    let ocActiveReason: string
    if (gatewaySource === 'external') {
      ocActiveSource = 'external'
      ocActiveReason = '已连接到外部 OpenClaw (直连模式)'
    } else {
      ocActiveSource = 'bundled'
      ocActiveReason = portConflictPending ? '检测到外部 OpenClaw，等待用户决策...' : '使用内置 OpenClaw'
    }

    const actualVersion: string | undefined = bundledOcVersion ?? undefined

    return {
      ok: true as const,
      result: {
        portConflict: portConflictPending,
        os: { platform, name: osNames[platform] ?? platform, release: os.release(), arch: os.arch() },
        node: {
          version: bundledNodeVersion,
          activeSource: nodeActiveSource,
          activeReason: nodeActiveReason,
          system: systemNode
            ? { available: true, version: systemNode.version, path: systemNode.path, satisfies: false }
            : null,
          bundled: { available: true, version: bundledNodeVersion },
        },
        openclaw: {
          version: actualVersion,
          running: openclawRunning,
          canStart: bundledOc !== null,
          system: null,
          bundled: { available: bundledOc !== null, version: bundledOcVersion ?? undefined, path: bundledOc?.openclawDir ?? null },
          activeSource: ocActiveSource,
          activeReason: ocActiveReason,
        },
      },
    }
  })

  // ── 手动启动内置 openclaw（UI 触发，用于 gateway 崩溃后重启）────────────────
  ipcMain.handle('env:install-openclaw', async (event) => {
    const send = (step: string, status: 'running' | 'done' | 'error', detail?: string) => {
      console.log(`[Openclaw:${step}][${status}] ${detail ?? ''}`)
      event.sender.send('env:install-progress', { step, status, detail })
    }

    send('node', 'done', `Electron Node.js ${process.versions.node}`)

    const bundledOc = getBundledOpenclaw()
    if (!bundledOc) {
      send('init', 'error', '找不到内置 openclaw (resources/openclaw/openclaw.mjs)')
      return { ok: false, error: '内置 openclaw 不存在' }
    }
    const { openclawDir, entryScript } = bundledOc

    send('init', 'running', '准备 Gateway 配置...')
    let token = readGatewayToken()
    if (token) {
      send('init', 'done', '已有有效配置')
    } else {
      token = crypto.randomBytes(24).toString('hex')
      writeGatewayConfig(token)
      send('init', 'done', 'Token 生成并写入完成')
    }

    send('start', 'running', '正在 fork OpenClaw Gateway...')

    const removeLogListener = addGatewayLogListener((line, isError) => {
      send('start', 'running', `${isError ? '[stderr] ' : ''}${line}`)
    })

    forkOpenclawGateway(entryScript, openclawDir, token, true)

    const started = await waitForGatewayReady(20_000)
    removeLogListener()

    if (!started) {
      send('start', 'error', `Gateway 20s 内未就绪 (port ${GATEWAY_PORT})`)
      return { ok: false, error: 'Gateway 启动超时' }
    }
    send('start', 'done', `Gateway 已就绪 (port ${GATEWAY_PORT})`)

    send('connect', 'running', '正在连接...')
    const cfg = { url: `ws://localhost:${GATEWAY_PORT}`, token }
    patchSettings({ gateway: cfg })
    await restartRuntime()
    send('connect', 'done', `已连接 (${cfg.url})`)

    return { ok: true, openclawDir, gatewayUrl: cfg.url }
  })

  // ── 端口冲突解决 ──────────────────────────────────────────────────────────
  ipcMain.handle('gateway:resolve-conflict', async (_, { action }: { action: 'connect' | 'stop-and-start' }) => {
    setPortConflictPending(false)

    if (action === 'connect') {
      // 直连：使用外部 OpenClaw，token 已在 autoSpawn 时写入 settings
      setGatewaySource('external')
      await restartRuntime()
      return { ok: true }
    }

    // stop-and-start：停止外部，启动内置
    const bundledOc = getBundledOpenclaw()
    if (!bundledOc) return { ok: false, error: '找不到内置 openclaw' }
    const { openclawDir, entryScript } = bundledOc

    const nodeBin = getBundledNodeBin()
    console.log('[ResolveConflict] stopping external gateway...')
    await new Promise<void>((resolve) => {
      const child = spawn(nodeBin, [entryScript, 'gateway', 'stop'], {
        cwd: openclawDir,
        windowsHide: true,
      })
      child.on('close', () => resolve())
      child.on('error', () => resolve())
      setTimeout(() => { try { child.kill() } catch {} resolve() }, 8000)
    })

    const portClosed = await waitForPortClosed(GATEWAY_PORT, 10_000)
    if (!portClosed) {
      console.warn('[ResolveConflict] port not released within 10s, retrying...')
      await new Promise(r => setTimeout(r, 2000))
    }

    let token = readGatewayToken()
    if (!token) {
      token = crypto.randomBytes(24).toString('hex')
      writeGatewayConfig(token)
    }

    patchSettings({ gateway: { url: `ws://localhost:${GATEWAY_PORT}`, token } })
    forkOpenclawGateway(entryScript, openclawDir, token, true)

    const ready = await checkPortOpen(GATEWAY_PORT, 30_000)
    if (ready) {
      setGatewaySource('bundled')
      console.log('[ResolveConflict] bundled gateway ready')
    } else {
      console.warn('[ResolveConflict] bundled gateway not ready within 30s')
    }

    await restartRuntime()
    return { ok: ready }
  })
}
