import type { IpcMain } from 'electron'
import type { GatewayAdapterError } from '../gateway/adapter'
import { getRuntime } from '../gateway/runtime'
import { readOpenclawConfig, writeOpenclawConfig, isRecord } from '../lib/openclaw-config'

const normalizeErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message
  return String(err)
}

const normalizeGatewayError = (err: unknown): { code?: string; message: string } => {
  const e = err as GatewayAdapterError | undefined
  if (e && typeof e === 'object' && typeof e.code === 'string') {
    return { code: e.code, message: e.message || normalizeErrorMessage(err) }
  }
  return { message: normalizeErrorMessage(err) }
}

export const registerChannelHandlers = (ipcMain: IpcMain): void => {
  // Read all channel configs from openclaw.json
  ipcMain.handle('openclaw:channels:get', () => {
    try {
      const config = readOpenclawConfig()
      const channels = isRecord(config.channels) ? config.channels : {}
      return { ok: true, channels }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // Write a specific channel config to openclaw.json
  ipcMain.handle(
    'openclaw:channels:set',
    (_event, params: { channelId: string; config: Record<string, unknown> }) => {
      try {
        const root = readOpenclawConfig()
        const channels = isRecord(root.channels) ? { ...root.channels } : {}
        channels[params.channelId] = params.config
        writeOpenclawConfig({ ...root, channels })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    },
  )

  // Read top-level bindings[] from openclaw.json
  ipcMain.handle('openclaw:bindings:get', () => {
    try {
      const config = readOpenclawConfig()
      const bindings = Array.isArray(config.bindings) ? config.bindings : []
      return { ok: true, bindings }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // Write top-level bindings[] to openclaw.json
  ipcMain.handle('openclaw:bindings:set', (_event, params: { bindings: unknown[] }) => {
    try {
      const root = readOpenclawConfig()
      const nextBindings = Array.isArray(params.bindings) ? params.bindings : []
      writeOpenclawConfig({ ...root, bindings: nextBindings })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle(
    'openclaw:channels:status',
    async (_event, params?: { probe?: boolean; timeoutMs?: number }) => {
      const adapter = getRuntime()
      if (!adapter) return { ok: false, error: 'Gateway not connected.', code: 'GATEWAY_UNAVAILABLE' }

      const probe = params?.probe === true
      const timeoutMs =
        typeof params?.timeoutMs === 'number' && Number.isFinite(params.timeoutMs)
          ? Math.max(1000, Math.min(Math.floor(params.timeoutMs), 60_000))
          : 12_000

      try {
        const payload = await adapter.request<Record<string, unknown>>('channels.status', { probe, timeoutMs })
        return { ok: true, payload }
      } catch (err) {
        const normalized = normalizeGatewayError(err)
        return { ok: false, error: normalized.message, code: normalized.code }
      }
    },
  )
}
