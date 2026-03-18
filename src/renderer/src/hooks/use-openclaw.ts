import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatAttachment } from '@/types'
import type { IpcApi } from '../../../preload'

// Access the IPC bridge exposed by preload
declare global {
  interface Window {
    ipc: IpcApi
  }
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type GatewayEvent = {
  type: 'runtime.status' | 'gateway.event'
  event?: string
  status?: string
  payload?: unknown
  asOf?: string
  reason?: string | null
  seq?: number | null
}

export type AgentSeed = {
  agentId: string
  name: string
  sessionKey: string
  emoji?: string
}

export type FleetResult = {
  seeds: AgentSeed[]
  sessionCreatedAgentIds: string[]
  suggestedSelectedAgentId: string | null
  configSnapshot: unknown
  mainAgentId: string | null
}

export type HistoryMessage = {
  role: 'user' | 'assistant' | 'system' | 'toolResult'
  content: unknown
  timestamp?: number
  thinkingDurationMs?: number
}

// ── Runtime event stream (via Electron IPC) ───────────────────────────────────

export function useRuntimeEventStream(onEvent: (event: GatewayEvent) => void) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const cleanupRef = useRef<(() => void) | null>(null)

  const connect = useCallback(function connectToRuntime() {
    // Remove previous listener
    cleanupRef.current?.()

    // Guard: contextBridge may not be ready in the first render cycle
    if (!window.ipc) {
      setTimeout(connectToRuntime, 50)
      return
    }

    setStatus('connecting')

    // Check initial status
    window.ipc.runtimeStatus().then((res) => {
      if (res && typeof res === 'object' && 'status' in res) {
        const s = (res as { status: string }).status
        if (s === 'connected') setStatus('connected')
        else if (s === 'error' || s === 'stopped') setStatus('error')
      }
    })

    // Subscribe to gateway events from main process
    const unsubscribe = window.ipc.onGatewayEvent((event) => {
      const e = event as GatewayEvent
      if (e.type === 'runtime.status') {
        if (e.status === 'connected') setStatus('connected')
        else if (e.status === 'error' || e.status === 'stopped') setStatus('error')
        else if (e.status === 'connecting' || e.status === 'reconnecting') setStatus('connecting')
      }
      onEventRef.current(e)
    })

    cleanupRef.current = unsubscribe
  }, [])

  const disconnect = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setStatus('disconnected')
  }, [])

  useEffect(() => {
    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [])

  return { status, connect, disconnect }
}

// ── Agent fleet ───────────────────────────────────────────────────────────────

export function useAgentFleet() {
  const [fleet, setFleet] = useState<FleetResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadFleet = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.ipc.runtimeFleet()
      if (!res || !res.ok) {
        setError((res as { error?: string })?.error ?? 'Failed to load fleet')
        return null
      }
      const data = res.result as { agents: AgentSeed[]; sessions: unknown[]; mainAgentId?: string | null }
      const result: FleetResult = {
        seeds: data.agents ?? [],
        sessionCreatedAgentIds: [],
        suggestedSelectedAgentId: data.agents[0]?.agentId ?? null,
        configSnapshot: null,
        mainAgentId: data.mainAgentId ?? null,
      }
      setFleet(result)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load fleet'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return { fleet, loading, error, loadFleet }
}

// ── Chat history ──────────────────────────────────────────────────────────────

export function useChatHistory() {
  const [loading, setLoading] = useState(false)

  const loadHistory = useCallback(async (agentId: string): Promise<HistoryMessage[]> => {
    setLoading(true)
    try {
      // Try full JSONL history first (includes pre-compaction messages)
      const sessionKey = `agent:${agentId}:main`
      const fullRes = await window.ipc.chatHistoryFull({ agentId, sessionKey })
      if (fullRes?.ok) {
        const data = fullRes.result as { messages?: HistoryMessage[] }
        if (data.messages && data.messages.length > 0) return data.messages
      }
      // Fall back to gateway API
      const res = await window.ipc.chatHistory({ agentId })
      if (!res || !res.ok) return []
      const data = res.result as { messages?: HistoryMessage[] }
      return data.messages ?? []
    } catch {
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  return { loading, loadHistory }
}

// ── Send message ──────────────────────────────────────────────────────────────

export function useSendMessage() {
  const [sending, setSending] = useState(false)

  const send = useCallback(async (
    agentId: string,
    content: string,
    sessionKey?: string,
    attachments?: ChatAttachment[]
  ) => {
    setSending(true)
    try {
      const idempotencyKey = `${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      // 图片附件 → base64 走 gateway attachments 通道
      const imageAttachments = (attachments ?? [])
        .filter((a) => !!a.dataUrl)
        .map((att) => {
          const match = /^data:([^;]+);base64,(.+)$/.exec(att.dataUrl!)
          if (!match) return null
          return { type: 'image', mimeType: match[1], content: match[2] }
        })
        .filter((a): a is NonNullable<typeof a> => a !== null)

      // 非图片文件 → 路径拼入消息末尾，让 agent 用 Read 工具读取
      const fileAttachments = (attachments ?? []).filter((a) => !!a.filePath)
      let message = content
      if (fileAttachments.length > 0) {
        const pathLines = fileAttachments.map((a) => a.filePath).join('\n')
        message = `${content}${content.trim() ? '\n\n' : ''}[本地文件]\n${pathLines}`
      }

      const payload: Parameters<typeof window.ipc.chatSend>[0] = {
        agentId,
        message,
        sessionKey: sessionKey ?? `agent:${agentId}:main`,
        idempotencyKey,
        ...(imageAttachments.length > 0 ? { attachments: imageAttachments } : {}),
      }

      return await window.ipc.chatSend(payload)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'send_failed' }
    } finally {
      setSending(false)
    }
  }, [])

  return { sending, send }
}

// ── Connection summary ────────────────────────────────────────────────────────

export function useConnectionSummary() {
  const [summary, setSummary] = useState<{ status: string; version: string | null } | null>(null)

  const loadSummary = useCallback(async () => {
    try {
      const res = await window.ipc.systemStatus()
      if (res && res.ok) {
        const data = res.result as { version?: string; status?: string }
        setSummary({ status: data.status ?? 'unknown', version: data.version ?? null })
      }
      return res
    } catch {
      return null
    }
  }, [])

  return { summary, loadSummary }
}
