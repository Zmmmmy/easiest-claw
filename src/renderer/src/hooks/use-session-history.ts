import { useState, useCallback } from "react"

export interface SessionRow {
  sessionKey: string | null
  sessionId: string
  updatedAt?: number
  displayName?: string
  label?: string
  kind?: string
  contextTokens?: number
  inputTokens?: number
  outputTokens?: number
  lastMessagePreview?: string
  isReset?: boolean
  resetTimestamp?: string | null
  isTracked?: boolean
}

export interface HistoryMsg {
  role: string
  content: unknown
  timestamp?: number
}

function parseHistoryMessages(raw: unknown): HistoryMsg[] {
  const obj = raw as Record<string, unknown> | unknown[]
  const list = Array.isArray((obj as Record<string, unknown>)?.messages)
    ? ((obj as { messages: unknown[] }).messages)
    : Array.isArray(obj) ? obj : []
  return (list as Record<string, unknown>[])
    .filter((m) => !(m.__openclaw && (m.__openclaw as Record<string, unknown>).kind === "compaction"))
    .map((m) => ({
      role: typeof m.role === "string" ? m.role : "unknown",
      content: m.content,
      timestamp: typeof m.timestamp === "number" ? m.timestamp : undefined,
    }))
}

export function useSessionHistory(agentId: string) {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<HistoryMsg[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const loadSessions = useCallback(async () => {
    if (!agentId) return
    setLoadingSessions(true)
    try {
      // Use filesystem scan to get ALL sessions (including orphaned/reset ones)
      const res = await window.ipc.sessionsListAll({ agentId })
      if (res?.ok) {
        const allSessions = (res.result as { sessions: SessionRow[] })?.sessions ?? []
        // Filter to this agent's sessions, already sorted by updatedAt desc from backend
        setSessions(allSessions)
        return
      }

      // Fall back to gateway sessions.list if filesystem scan fails
      const fallbackRes = await window.ipc.sessionsList({
        agentId,
        includeLastMessage: true,
        includeDerivedTitles: true,
      })
      if (fallbackRes.ok) {
        const raw = fallbackRes.result as Record<string, unknown>
        const list = Array.isArray(raw?.sessions) ? (raw.sessions as Record<string, unknown>[]) : []
        const filtered = list
          .filter((s) => typeof s.key === "string" && (s.key as string).startsWith(`agent:${agentId}:`))
          .map((s) => ({
            sessionKey: s.key as string,
            sessionId: (s.sessionId as string) ?? "",
            updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : undefined,
            displayName: typeof s.displayName === "string" ? s.displayName : undefined,
            lastMessagePreview: typeof s.lastMessagePreview === "string" ? s.lastMessagePreview : undefined,
          }))
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        setSessions(filtered)
      }
    } catch {
      // silently fail
    } finally {
      setLoadingSessions(false)
    }
  }, [agentId])

  const selectSession = useCallback(async (sessionId: string, sessionKey?: string | null) => {
    setSelectedSessionKey(sessionKey ?? null)
    setSelectedSessionId(sessionId)
    setLoadingHistory(true)
    setMessages([])
    try {
      // Try full JSONL history first (includes pre-compaction messages)
      const fullRes = await window.ipc.chatHistoryFull({
        agentId,
        sessionId,
        sessionKey: sessionKey ?? undefined,
      })
      if (fullRes?.ok) {
        setMessages(parseHistoryMessages(fullRes.result))
        return
      }
      // Fall back to gateway API (only works for tracked sessions)
      if (sessionKey) {
        const res = await window.ipc.chatHistory({ agentId, sessionKey })
        if (res?.ok) {
          setMessages(parseHistoryMessages(res.result))
        }
      }
    } catch {
      // silently fail
    } finally {
      setLoadingHistory(false)
    }
  }, [agentId])

  const clearSelection = useCallback(() => {
    setSelectedSessionKey(null)
    setSelectedSessionId(null)
    setMessages([])
  }, [])

  return {
    sessions,
    selectedSessionKey,
    selectedSessionId,
    messages,
    loadingSessions,
    loadingHistory,
    loadSessions,
    selectSession,
    clearSelection,
  }
}
