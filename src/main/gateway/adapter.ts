import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import type { ConnectionStatus, DomainEvent, GatewayEventFrame, GatewayResponseFrame, GatewaySettings } from './types'
import { loadSettings } from './settings'
import {
  loadOrCreateDeviceIdentity,
  signDevicePayload,
  publicKeyRawBase64Url,
  buildDeviceAuthPayload,
  type DeviceIdentity,
} from './device-identity'

const CONNECT_TIMEOUT_MS = 8_000
const REQUEST_TIMEOUT_MS = 15_000
const INITIAL_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 15_000
const CONNECT_PROTOCOL = 3

// 3.12+ 引入的设备认证错误码；遇到这些错误时降级到 token-only 重试
const DEVICE_AUTH_ERROR_CODES = new Set([
  'DEVICE_AUTH_NONCE_REQUIRED',
  'DEVICE_AUTH_NONCE_MISMATCH',
  'DEVICE_AUTH_SIGNATURE_INVALID',
  'DEVICE_AUTH_SIGNATURE_EXPIRED',
  'DEVICE_AUTH_DEVICE_ID_MISMATCH',
  'DEVICE_AUTH_PUBLIC_KEY_INVALID',
])

const METHOD_ALLOWLIST = new Set<string>([
  'status',
  'health',
  'chat.send',
  'chat.abort',
  'chat.history',
  'agents.create',
  'agents.update',
  'agents.delete',
  'agents.list',
  'agents.files.list',
  'agents.files.get',
  'agents.files.set',
  'agent.identity.get',
  'sessions.list',
  'sessions.preview',
  'sessions.patch',
  'sessions.reset',
  'cron.list',
  'cron.run',
  'cron.remove',
  'cron.add',
  'cron.runs',
  'cron.status',
  'cron.update',
  'config.get',
  'config.set',
  'config.patch',
  'config.apply',
  'config.schema',
  'models.list',
  'exec.approval.resolve',
  'exec.approvals.get',
  'exec.approvals.set',
  'agent.wait',
  'system-presence',
  'logs.tail',
  'skills.status',
  'skills.update',
  'skills.install',
  'tools.catalog',
  'channels.status',
])

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class GatewayAdapterError extends Error {
  readonly code: string
  readonly details?: unknown

  constructor(params: { code: string; message: string; details?: unknown }) {
    super(params.message)
    this.name = 'GatewayAdapterError'
    this.code = params.code
    this.details = params.details
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === 'object')

export class GatewayAdapter {
  private ws: WebSocket | null = null
  private status: ConnectionStatus = 'stopped'
  private statusReason: string | null = null
  private connectRequestId: string | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private startPromise: Promise<void> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private stopping = false
  private nextReqNum = 1
  private connectionEpoch: string | null = null
  private pending = new Map<string, PendingRequest>()
  private onDomainEvent?: (event: DomainEvent) => void

  // 设备身份（首次连接时懒加载，之后复用）
  private readonly deviceIdentityPath: string
  private deviceIdentity: DeviceIdentity | null = null
  // 设备认证失败后跳过 device 字段，持久化跨重连（仅在成功连接后重置）
  private skipDeviceAuth = false

  constructor(onDomainEvent?: (event: DomainEvent) => void, deviceIdentityPath?: string) {
    this.onDomainEvent = onDomainEvent
    this.deviceIdentityPath = deviceIdentityPath ?? ''
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  getStatusReason(): string | null {
    return this.statusReason
  }

  async start(): Promise<void> {
    if (this.status === 'connected') return
    if (this.startPromise) return this.startPromise
    this.stopping = false
    this.startPromise = this.connect().finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    this.rejectPending('Gateway adapter stopped.')
    const ws = this.ws
    this.ws = null
    this.connectRequestId = null
    this.connectionEpoch = null
    if (ws && ws.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        ws.once('close', () => resolve())
        ws.close(1000, 'adapter stopping')
      })
    } else {
      ws?.terminate()
    }
    this.updateStatus('stopped', null)
  }

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    const m = method.trim()
    if (!m) throw new Error('Gateway method is required.')
    if (!METHOD_ALLOWLIST.has(m)) throw new Error(`Method not allowed: ${m}`)

    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN || this.status !== 'connected') {
      throw new GatewayAdapterError({ code: 'GATEWAY_UNAVAILABLE', message: 'Gateway is unavailable.' })
    }

    const id = String(this.nextReqNum++)
    const frame = { type: 'req', id, method: m, params }

    const response = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Gateway request timed out: ${m}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify(frame), (err) => {
        if (!err) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error(`Failed to send gateway request: ${m}`))
      })
    })

    return response as T
  }

  private async connect(): Promise<void> {
    // ── 设备身份：懒加载，首次成功后复用 ─────────────────────────────────────
    if (this.deviceIdentityPath && !this.deviceIdentity) {
      try {
        this.deviceIdentity = loadOrCreateDeviceIdentity(this.deviceIdentityPath)
        console.log(`[GatewayAdapter] Device identity ready: ${this.deviceIdentity.deviceId.slice(0, 8)}…`)
      } catch (e) {
        console.warn('[GatewayAdapter] Could not load device identity, will connect without device auth:', e)
      }
    }

    // ── 清理旧连接：防止重连时两个 WebSocket 同时存在 ─────────────────────────
    if (this.ws) {
      const oldWs = this.ws
      this.ws = null
      oldWs.removeAllListeners()
      oldWs.terminate()
    }

    const settings = this.loadGatewaySettings()
    console.log(`[GatewayAdapter] Connecting to ${settings.url} (attempt ${this.reconnectAttempt + 1})`)
    this.connectionEpoch = randomUUID()
    // 不设置 origin：Node.js ws 库默认不发送 Origin 头，
    // 主动设置 Origin 会让 gateway 误判为浏览器客户端，导致 loopback 自动配对被阻止
    const ws = new WebSocket(settings.url)
    this.ws = ws
    this.connectRequestId = null
    this.updateStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting', null)

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        if (this.connectTimer) {
          clearTimeout(this.connectTimer)
          this.connectTimer = null
        }
        fn()
      }

      this.connectTimer = setTimeout(() => {
        settle(() => {
          ws.close(1011, 'connect timeout')
          reject(new Error('Connect timed out.'))
        })
      }, CONNECT_TIMEOUT_MS)

      ws.on('message', (raw) => {
        const parsed = this.parseFrame(String(raw ?? ''))
        if (!parsed) return

        if (parsed.type === 'event') {
          if (parsed.event === 'connect.challenge') {
            // nonce 在 3.12+ 存在；旧版本 payload 没有 nonce → undefined → token-only
            const nonce = isObject(parsed.payload)
              ? (parsed.payload.nonce as string | undefined)
              : undefined
            console.log(
              `[GatewayAdapter] Received connect.challenge${nonce ? ' (nonce present, using device auth)' : ' (no nonce, legacy token-only)'}`
            )
            this.sendConnectRequest(settings.token, nonce)
            return
          }
          this.emitEvent({
            type: 'gateway.event',
            event: parsed.event,
            seq: typeof parsed.seq === 'number' ? parsed.seq : null,
            connectionEpoch: this.connectionEpoch,
            payload: parsed.payload,
            asOf: new Date().toISOString(),
          })
          return
        }

        if (!this.handleResponse(parsed)) return
        if (parsed.id === this.connectRequestId) {
          if (parsed.ok) {
            console.log('[GatewayAdapter] Connected successfully')
            this.reconnectAttempt = 0
            this.skipDeviceAuth = false  // 成功后重置，下次允许再用设备认证
            this.updateStatus('connected', null)
            settle(() => resolve())
            return
          }

          const code = parsed.error?.code ?? 'CONNECT_FAILED'
          const msg = parsed.error?.message ?? 'Connect failed.'
          // 设备认证错误码可能在顶层 code 或 details.code 中
          const detailCode = isObject(parsed.error?.details)
            ? (parsed.error.details.code as string | undefined) ?? ''
            : ''

          // ── 设备认证失败 → 降级到 token-only（仅一次）───────────────────
          // 兼容旧版本网关或配置不当的情况
          // 注意：网关在返回错误后会关闭连接（1008），不能在当前 ws 上重发；
          // 设置持久化 skipDeviceAuth 标志，由重连周期自动使用 token-only
          if (!this.skipDeviceAuth && (DEVICE_AUTH_ERROR_CODES.has(code) || DEVICE_AUTH_ERROR_CODES.has(detailCode))) {
            console.warn(`[GatewayAdapter] Device auth failed (${code}), next reconnect will use token-only`)
            this.skipDeviceAuth = true
            this.connectRequestId = null
            // 不在此处重发：gateway 将以 1008 关闭连接，触发正常重连流程
            return
          }

          console.error(`[GatewayAdapter] Connect rejected: ${code} ${msg}`, parsed.error?.details)
          settle(() => {
            ws.close(1011, 'connect failed')
            reject(new Error(`Connect rejected: ${code} ${msg}`))
          })
        }
      })

      ws.on('close', () => {
        if (this.stopping) return
        if (!settled) {
          settle(() => reject(new Error('Connection closed during connect.')))
          return
        }
        this.rejectPending('Gateway connection closed.')
        this.connectionEpoch = null
        this.updateStatus('reconnecting', 'gateway_closed')
        this.scheduleReconnect()
      })

      ws.on('error', (error) => {
        if (this.stopping) return
        if (!settled) {
          const detail = (error as NodeJS.ErrnoException).code
            ? `${(error as NodeJS.ErrnoException).code} ${error.message}`.trim()
            : error.message || String(error)
          console.error(`[GatewayAdapter] WebSocket error: ${detail}`)
          settle(() => reject(new Error(`Connect failed: ${detail}`)))
        }
      })
    }).catch((err) => {
      this.connectionEpoch = null
      const reason = err instanceof Error ? err.message : 'connect_error'
      if (this.reconnectAttempt <= 1) {
        console.error(`[GatewayAdapter] Connection failed: ${reason}`)
      }
      this.updateStatus('error', reason)
      this.scheduleReconnect()
      throw err
    })
  }

  private loadGatewaySettings(): GatewaySettings {
    const settings = loadSettings()
    const gw = settings.gateway
    if (!gw?.url) throw new Error('Gateway URL is not configured.')
    if (!gw?.token) throw new Error('Gateway token is not configured.')
    return { url: gw.url, token: gw.token }
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(1.7, this.reconnectAttempt),
      MAX_RECONNECT_DELAY_MS
    )
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.start().catch(() => {})
    }, delay)
  }

  /**
   * 发送 connect 请求。
   *
   * - nonce 存在（3.12+）且设备身份可用且未被禁用 → 附带 device 字段
   * - nonce 不存在（旧版本）或设备身份不可用或 skipDeviceAuth=true → 纯 token 模式
   */
  private sendConnectRequest(token: string, nonce: string | undefined): void {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN || this.connectRequestId) return

    const id = String(this.nextReqNum++)
    this.connectRequestId = id

    const scopes = ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing']

    // 构造 device 字段：仅在 nonce 存在、身份可用、且未被设备认证禁用时
    let device: Record<string, unknown> | undefined
    if (nonce && this.deviceIdentity && !this.skipDeviceAuth) {
      try {
        const signedAtMs = Date.now()
        const payload = buildDeviceAuthPayload({
          deviceId: this.deviceIdentity.deviceId,
          clientId: 'gateway-client',
          clientMode: 'backend',
          role: 'operator',
          scopes,
          signedAtMs,
          token,
          nonce,
          platform: process.platform,
        })
        const signature = signDevicePayload(this.deviceIdentity.privateKeyPem, payload)
        device = {
          id: this.deviceIdentity.deviceId,
          publicKey: publicKeyRawBase64Url(this.deviceIdentity.publicKeyPem),
          signature,
          signedAt: signedAtMs,
          nonce,
        }
      } catch (e) {
        console.warn('[GatewayAdapter] Failed to build device auth payload, connecting without device:', e)
        device = undefined
      }
    }

    try {
      ws.send(
        JSON.stringify({
          type: 'req',
          id,
          method: 'connect',
          params: {
            minProtocol: CONNECT_PROTOCOL,
            maxProtocol: CONNECT_PROTOCOL,
            client: {
              id: 'gateway-client',
              version: '0.1.0',
              platform: process.platform,  // 必须与签名 payload 中的 platform 一致
              mode: 'backend',
            },
            role: 'operator',
            scopes,
            caps: ['tool-events'],
            auth: { token },
            ...(device ? { device } : {}),
          },
        })
      )
    } catch (err) {
      this.connectRequestId = null
      const reason = err instanceof Error ? err.message : 'connect_send_failed'
      this.updateStatus('error', reason)
      try { ws.close(1011, 'connect send failed') } catch { /* ignore */ }
    }
  }

  private parseFrame(raw: string): GatewayEventFrame | GatewayResponseFrame | null {
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return null }
    if (!isObject(parsed) || typeof parsed.type !== 'string') return null
    if (parsed.type === 'event' && typeof parsed.event === 'string') return parsed as GatewayEventFrame
    if (parsed.type === 'res' && typeof parsed.id === 'string') return parsed as GatewayResponseFrame
    return null
  }

  private handleResponse(frame: GatewayResponseFrame): boolean {
    const pending = this.pending.get(frame.id)
    if (!pending) return true
    clearTimeout(pending.timer)
    this.pending.delete(frame.id)
    if (frame.ok) {
      pending.resolve(frame.payload)
    } else {
      pending.reject(
        new GatewayAdapterError({
          code: frame.error?.code ?? 'GATEWAY_REQUEST_FAILED',
          message: frame.error?.message ?? 'Gateway request failed.',
          details: frame.error?.details,
        })
      )
    }
    return true
  }

  private rejectPending(message: string): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }

  private updateStatus(status: ConnectionStatus, reason: string | null): void {
    this.status = status
    this.statusReason = reason
    this.emitEvent({ type: 'runtime.status', status, reason, asOf: new Date().toISOString() })
  }

  private emitEvent(event: DomainEvent): void {
    this.onDomainEvent?.(event)
  }
}
