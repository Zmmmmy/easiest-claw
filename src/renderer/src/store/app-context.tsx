


import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { ChatAttachment } from "@/types"
import { resolveRoutingDecision, parseMentions, resolveMentionedAgentIds } from "@/lib/orchestration/router"
import {
  useRuntimeEventStream,
  useAgentFleet,
  useChatHistory,
  useSendMessage,
  type GatewayEvent,
  type ConnectionStatus,
} from "@/hooks/use-openclaw"
import type { AppContextValue } from "./app-types"
import { initialState } from "./app-types"
import { appReducer } from "./app-reducer"
import {
  saveGroupMessagesToStorage,
  loadGroupsFromStorage,
  loadGroupMessagesFromStorage,
} from "./app-storage"
import { uniqueId, parseViewFromHash, extractTextContent, extractImageAttachments, resolveAgentIdFromPayload } from "./app-utils"
import { saveAttachmentCacheDb, getAttachmentCacheDb } from "@/lib/db"

function buildWorkspacePrompt(workspacePath: string, content: string): string {
  return [
    "【共享工作区 - 重要】",
    "本次任务在多智能体协作项目中进行，请严格遵守以下规则：",
    `1. 你的工作目录是：${workspacePath}`,
    "2. 所有文件读写操作必须在此目录下进行，禁止使用你的默认工作区",
    "3. 这是一个共享工作区，其他团队成员也在此目录下协作",
    "4. 请保持文件组织清晰，避免覆盖他人的工作成果",
    "---",
    content,
  ].join("\n")
}

/** 在 dispatch LOAD_HISTORY 前预取 IndexedDB 附件缓存。 */
async function prefetchAttachmentOverrides(
  convId: string,
  messages: import("@/hooks/use-openclaw").HistoryMessage[]
): Promise<ChatAttachment[][]> {
  return Promise.all(
    messages.map(async (m) => {
      if (m.role !== "user") return []
      if (extractImageAttachments(m.content).length > 0) return []
      const text = extractTextContent(m.content)
      return getAttachmentCacheDb(convId, text)
    })
  )
}


const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const { loadFleet } = useAgentFleet()
  const { loadHistory } = useChatHistory()
  const { send } = useSendMessage()
  const initializedRef = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state
  // Tracks coordinator message IDs already processed in THIS session (prevents double-dispatch)
  const processedCoordinatorMsgsRef = useRef(new Set<string>())
  // Tracks message IDs loaded from storage at startup (must never be re-dispatched)
  const preloadedGroupMsgIds = useRef(new Set<string>())

  const compactionRunsByConversationRef = useRef(new Map<string, Set<string>>())
  const compactionDoneTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [compactingConversationIds, setCompactingConversationIds] = useState<Set<string>>(new Set())
  const [compactedConversationIds, setCompactedConversationIds] = useState<Set<string>>(new Set())
  // 网关事件去重：
  // 1) 基于 connectionEpoch + seq 的帧级去重（避免重复消费同一帧）
  // 2) 基于 payload 语义的终态事件去重（避免 final/end/error 被重放）
  const eventDedupeRef = useRef(new Map<string, number>())
  const DEDUP_TTL_MS = 30_000
  const MAX_DEDUP_KEYS = 4000

  const handleEvent = useCallback((event: GatewayEvent) => {
    if (event.type === "gateway.event") {
      const now = Date.now()
      const map = eventDedupeRef.current

      if (map.size > MAX_DEDUP_KEYS) {
        for (const [k, ts] of map) {
          if (now - ts > DEDUP_TTL_MS) map.delete(k)
        }
        if (map.size > MAX_DEDUP_KEYS) {
          let overflow = map.size - MAX_DEDUP_KEYS
          for (const k of map.keys()) {
            map.delete(k)
            overflow -= 1
            if (overflow <= 0) break
          }
        }
      }

      // 帧级去重：同一网关帧只处理一次。
      if (typeof event.seq === "number") {
        const rec = event as unknown as Record<string, unknown>
        const epoch = typeof rec.connectionEpoch === "string" ? rec.connectionEpoch : "no-epoch"
        const frameKey = `frame:${epoch}:${event.seq}`
        const seenAt = map.get(frameKey)
        if (typeof seenAt === "number" && (now - seenAt) < DEDUP_TTL_MS) return
        map.set(frameKey, now)
      }

      // 终态事件语义去重：同一逻辑完成事件可能被重放。
      const pl = event.payload as Record<string, unknown> | undefined
      if (pl) {
        const runId = pl.runId != null ? String(pl.runId) : ""
        const sessionKey = pl.sessionKey != null ? String(pl.sessionKey) : ""
        const evtName = event.event ?? ""
        // chat 事件使用 state（delta/final/error/aborted）
        const state = pl.state != null ? String(pl.state) : ""
        // agent 事件使用 stream + phase
        const data = pl.data as Record<string, unknown> | undefined
        const stream = pl.stream != null ? String(pl.stream) : ""
        const phase = data?.phase != null ? String(data.phase) : ""
        // delta 是增量流，不能去重；只对终态事件去重。
        const isTerminal = state === "final" || state === "error" || state === "aborted"
          || phase === "end" || phase === "error" || phase === "completed"
        if (isTerminal && runId) {
          const dedupeKey = `terminal:${[runId, sessionKey, evtName, state, stream, phase].join("|")}`
          if (map.has(dedupeKey)) return
          map.set(dedupeKey, now)
        }
      }
    }

    // 按会话跟踪压缩生命周期，用于头部内联状态展示
    if (event.type === "gateway.event" && event.event === "agent") {
      const payload = event.payload as Record<string, unknown> | undefined
      if (payload && payload.stream === "compaction") {
        const data = payload.data as Record<string, unknown> | undefined
        const phase = data?.phase != null ? String(data.phase) : ""
        const runId = payload.runId != null ? String(payload.runId) : ""
        const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : ""
        const groupMatch = sessionKey.match(/^agent:[^:]+:group:(.+)$/)
        const agentId = resolveAgentIdFromPayload(payload)
        const conversationId = groupMatch ? groupMatch[1] : (agentId ? `conv-${agentId}` : null)

        if (conversationId && (phase === "start" || phase === "end" || phase === "error" || phase === "completed")) {
          const runKey = runId || "__no_run__"
          const runsMap = compactionRunsByConversationRef.current
          const activeRuns = new Set(runsMap.get(conversationId) ?? [])

          if (phase === "start") {
            if (activeRuns.has(runKey)) {
              dispatch({ type: "GATEWAY_EVENT", payload: event })
              return
            }

            activeRuns.add(runKey)
            runsMap.set(conversationId, activeRuns)

            const doneTimer = compactionDoneTimersRef.current.get(conversationId)
            if (doneTimer) {
              clearTimeout(doneTimer)
              compactionDoneTimersRef.current.delete(conversationId)
            }

            setCompactedConversationIds((prev) => {
              if (!prev.has(conversationId)) return prev
              const next = new Set(prev)
              next.delete(conversationId)
              return next
            })

            setCompactingConversationIds((prev) => {
              if (prev.has(conversationId)) return prev
              const next = new Set(prev)
              next.add(conversationId)
              return next
            })
          } else {
            if (activeRuns.has(runKey)) {
              activeRuns.delete(runKey)
            } else if (!runId && activeRuns.size > 0) {
              const firstRun = activeRuns.values().next().value
              if (firstRun) activeRuns.delete(firstRun)
            } else {
              dispatch({ type: "GATEWAY_EVENT", payload: event })
              return
            }

            if (activeRuns.size > 0) {
              runsMap.set(conversationId, activeRuns)
            } else {
              runsMap.delete(conversationId)

              setCompactingConversationIds((prev) => {
                if (!prev.has(conversationId)) return prev
                const next = new Set(prev)
                next.delete(conversationId)
                return next
              })

              setCompactedConversationIds((prev) => {
                if (prev.has(conversationId)) return prev
                const next = new Set(prev)
                next.add(conversationId)
                return next
              })

              const existingTimer = compactionDoneTimersRef.current.get(conversationId)
              if (existingTimer) clearTimeout(existingTimer)
              const timer = setTimeout(() => {
                compactionDoneTimersRef.current.delete(conversationId)
                setCompactedConversationIds((prev) => {
                  if (!prev.has(conversationId)) return prev
                  const next = new Set(prev)
                  next.delete(conversationId)
                  return next
                })
              }, 5000)
              compactionDoneTimersRef.current.set(conversationId, timer)
            }
          }
        }
      }
    }

    dispatch({ type: "GATEWAY_EVENT", payload: event })
  }, [])

  // 在 useRuntimeEventStream 之前定义 refreshFleet，便于 status effect 引用。
  const refreshFleet = useCallback(async () => {
    const result = await loadFleet()
    if (result?.seeds && result.seeds.length > 0) {
      dispatch({ type: "SET_FLEET", payload: { seeds: result.seeds, mainAgentId: result.mainAgentId ?? null } })
      for (const seed of result.seeds) {
        const convId = `conv-${seed.agentId}`
        loadHistory(seed.agentId).then(async (messages) => {
          if (messages.length === 0) return
          const attachmentOverrides = await prefetchAttachmentOverrides(convId, messages)
          dispatch({
            type: "LOAD_HISTORY",
            payload: {
              conversationId: convId,
              agentId: seed.agentId,
              messages,
              attachmentOverrides,
            },
          })
        })
      }
    }
  }, [loadFleet, loadHistory])

  const checkModelsConfigured = useCallback(async () => {
    try {
      const res = await window.ipc.openclawModelsGet()
      if (!res || !res.ok) {
        dispatch({ type: "SET_MODELS_CONFIGURED", payload: false })
        return
      }
      const result = res as { providers: Record<string, unknown>; defaults: { primary: string } }
      const hasProviders = result.providers && Object.keys(result.providers).length > 0
      const hasPrimary = !!result.defaults?.primary
      dispatch({ type: "SET_MODELS_CONFIGURED", payload: !!(hasProviders && hasPrimary) })
    } catch {
      // IPC 尚未就绪时保持默认值（true），避免界面闪烁
    }
  }, [])

  const { status, connect } = useRuntimeEventStream(handleEvent)

  const prevStatusRef = useRef<ConnectionStatus>("disconnected")
  const fleetRetryRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    dispatch({ type: "SET_CONNECTION_STATUS", payload: status })

    // 每次网关重连后刷新 agent 列表与历史记录
    if (status === "connected" && prevStatusRef.current !== "connected") {
      refreshFleet()
      checkModelsConfigured()

      // 网关尚未完全就绪时，agent 列表可能为空，最多重试 20 秒
      if (fleetRetryRef.current) clearInterval(fleetRetryRef.current)
      let elapsed = 0
      fleetRetryRef.current = setInterval(() => {
        elapsed += 1000
        if (stateRef.current.agents.length > 0 || elapsed >= 20000) {
          if (fleetRetryRef.current) clearInterval(fleetRetryRef.current)
          fleetRetryRef.current = null
          return
        }
        refreshFleet()
      }, 1000)
    }

    // 断开连接后停止重试循环
    if (status !== "connected" && fleetRetryRef.current) {
      clearInterval(fleetRetryRef.current)
      fleetRetryRef.current = null
    }
    prevStatusRef.current = status

    return () => {
      if (fleetRetryRef.current) {
        clearInterval(fleetRetryRef.current)
        fleetRetryRef.current = null
      }
    }
  }, [status, refreshFleet, checkModelsConfigured])

  useEffect(() => {
    return () => {
      for (const timer of compactionDoneTimersRef.current.values()) {
        clearTimeout(timer)
      }
      compactionDoneTimersRef.current.clear()
      compactionRunsByConversationRef.current.clear()
    }
  }, [])

  // Persist group messages to localStorage whenever messages change
  // Skip until initialization is complete to avoid overwriting saved data with empty state
  useEffect(() => {
    if (!initializedRef.current) return
    saveGroupMessagesToStorage(state.messages, state.conversations)
  }, [state.messages, state.conversations])

  // Coordinator auto-routing: when the coordinator's finalized response contains @mentions,
  // automatically send the original user message to those mentioned agents
  useEffect(() => {
    for (const conv of state.conversations) {
      if (conv.type !== "group" || conv.orchestration?.strategy !== "coordinator") continue
      const coordinatorId = conv.orchestration.coordinatorId
      if (!coordinatorId) continue

      const msgs = state.messages[conv.id]
      if (!msgs || msgs.length < 2) continue

      // Find the last finalized coordinator message (not streaming)
      const lastCoordinatorMsg = msgs
        .filter((m) => m.senderId === coordinatorId && !m.id.startsWith("streaming-"))
        .at(-1)
      if (!lastCoordinatorMsg) continue
      // Skip messages loaded from storage at startup - they were already handled in a previous session
      if (preloadedGroupMsgIds.current.has(lastCoordinatorMsg.id)) continue
      if (processedCoordinatorMsgsRef.current.has(lastCoordinatorMsg.id)) continue

      // Check for @mentions in the coordinator's response
      const mentions = parseMentions(lastCoordinatorMsg.content)
      if (mentions.length === 0) continue

      const agentMemberIds = conv.members.filter((id) => id !== "user" && id !== coordinatorId)
      const mentionedIds = resolveMentionedAgentIds(mentions, state.agents, agentMemberIds)
      if (mentionedIds.length === 0) continue

      // Find the last user message before the coordinator's response
      const coordinatorMsgIdx = msgs.indexOf(lastCoordinatorMsg)
      const lastUserMsg = msgs
        .slice(0, coordinatorMsgIdx)
        .filter((m) => m.senderId === "user")
        .at(-1)
      if (!lastUserMsg) continue

      // Mark as processed before sending to prevent re-triggering
      processedCoordinatorMsgsRef.current.add(lastCoordinatorMsg.id)

      // Show orchestration decision
      const names = mentionedIds
        .map((id) => state.agents.find((a) => a.id === id)?.name ?? id)
        .join("、")
      dispatch({
        type: "ADD_ORCHESTRATION_MESSAGE",
        payload: {
          conversationId: conv.id,
          strategy: "coordinator",
          selectedAgents: mentionedIds,
          reason: `协调人已分派 → ${names}`,
        },
      })

      // Send original user message to mentioned agents
      mentionedIds.forEach((agentId, index) => {
        const sessionKey = `agent:${agentId}:group:${conv.id}`
        const baseContent = lastUserMsg.content
        const messageContent = conv.workspacePath
          ? buildWorkspacePrompt(conv.workspacePath, baseContent)
          : baseContent
        setTimeout(() => {
          send(agentId, messageContent, sessionKey)
        }, index * 500)
      })
    }
  }, [state.messages, state.conversations, state.agents, send, dispatch])

  // Connect in its own effect so React StrictMode remounts re-register the subscription.
  // (StrictMode unmounts and remounts, which clears gatewayCallbacks; without this separate
  // effect the initializedRef guard prevents connect() from running on the real mount.)
  useEffect(() => {
    connect()
  }, [connect])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    // Restore persisted group conversations and their messages from localStorage
    const savedGroups = loadGroupsFromStorage()
    if (savedGroups.length > 0) {
      dispatch({ type: "LOAD_GROUPS", payload: savedGroups })
    }
    const savedGroupMessages = loadGroupMessagesFromStorage()
    if (Object.keys(savedGroupMessages).length > 0) {
      // Record all pre-loaded IDs so coordinator routing never re-dispatches them
      for (const msgs of Object.values(savedGroupMessages)) {
        for (const msg of msgs) preloadedGroupMsgIds.current.add(msg.id)
      }
      dispatch({ type: "LOAD_GROUP_MESSAGES", payload: savedGroupMessages })
    }

    loadFleet().then((result) => {
      if (result?.seeds) {
        dispatch({ type: "SET_FLEET", payload: { seeds: result.seeds, mainAgentId: result.mainAgentId ?? null } })
        // Load chat history for each agent
        for (const seed of result.seeds) {
          const convId = `conv-${seed.agentId}`
          loadHistory(seed.agentId).then(async (messages) => {
            if (messages.length === 0) return
            const attachmentOverrides = await prefetchAttachmentOverrides(convId, messages)
            dispatch({
              type: "LOAD_HISTORY",
              payload: {
                conversationId: convId,
                agentId: seed.agentId,
                messages,
                attachmentOverrides,
              },
            })
          })
        }
      }
    })
  }, [loadFleet, loadHistory])

  // Restore view from URL hash on mount
  useEffect(() => {
    const initialView = parseViewFromHash()
    if (initialView !== "chat") {
      dispatch({ type: "SET_VIEW", payload: initialView })
    }
  }, [])

  // Sync view state -> URL hash
  useEffect(() => {
    const hash = `#${state.view}`
    if (window.location.hash !== hash) {
      window.location.hash = hash
    }
  }, [state.view])

  // Listen for browser back/forward navigation
  useEffect(() => {
    const handleHashChange = () => {
      const view = parseViewFromHash()
      if (view !== stateRef.current.view) {
        dispatch({ type: "SET_VIEW", payload: view })
      }
    }
    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [])

  const sendMessage = useCallback(
    (conversationId: string, content: string, attachments?: ChatAttachment[]) => {
      dispatch({ type: "SEND_MESSAGE", payload: { conversationId, content, attachments } })

      const imageAtts = (attachments ?? []).filter((a) => !!a.dataUrl)
      if (imageAtts.length > 0) {
        saveAttachmentCacheDb(conversationId, content, imageAtts).catch(() => {})
      }

      const conv = stateRef.current.conversations.find((c) => c.id === conversationId)
      if (!conv) return

      const agentMemberIds = conv.members.filter((id) => id !== "user")
      if (agentMemberIds.length === 0) return

      const sendError = (error: string) => {
        dispatch({
          type: "ADD_AGENT_MESSAGE",
          payload: {
            id: uniqueId("msg-err"),
            conversationId,
            senderId: "system",
            senderName: "系统",
            senderAvatar: "SY",
            content: `发送失败: ${error}`,
            timestamp: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
            read: true,
            type: "system",
          },
        })
      }

      if (conv.type !== "group") {
        // Direct conversation -- send to the single agent
        send(agentMemberIds[0], content, undefined, attachments).then((result) => {
          if (!result.ok) {
            const agent = stateRef.current.agents.find((a) => a.id === agentMemberIds[0])
            sendError(`${agent?.name ?? agentMemberIds[0]}: ${(result as { error?: string }).error ?? "未知错误"}`)
          }
        })
        return
      }

      // Group conversation -- use orchestration router
      const mentions = parseMentions(content)
      const agents = stateRef.current.agents
      const decision = resolveRoutingDecision(content, conv, agents, mentions)

      // Show orchestration decision for non-trivial routing
      if (
        decision.strategy !== "all" &&
        mentions.length === 0 &&
        decision.targetAgentIds.length < agentMemberIds.length
      ) {
        dispatch({
          type: "ADD_ORCHESTRATION_MESSAGE",
          payload: {
            conversationId,
            strategy: decision.strategy,
            selectedAgents: decision.targetAgentIds,
            reason: decision.reason,
          },
        })
      }

      // Send to selected agents
      decision.targetAgentIds.forEach((agentId, index) => {
        const delay = index * 500
        const sessionKey = `agent:${agentId}:group:${conversationId}`
        const baseContent =
          decision.coordinatorMessage && agentId === conv.orchestration?.coordinatorId
            ? decision.coordinatorMessage
            : content
        const messageContent = conv.workspacePath
          ? buildWorkspacePrompt(conv.workspacePath, baseContent)
          : baseContent

        setTimeout(() => {
          send(agentId, messageContent, sessionKey, attachments).then((result) => {
            if (!result.ok) {
              const agent = stateRef.current.agents.find((a) => a.id === agentId)
              sendError(`${agent?.name ?? agentId}: ${(result as { error?: string }).error ?? "未知错误"}`)
            }
          })
        }, delay)
      })

      // Advance round-robin pointer
      if (decision.strategy === "round-robin") {
        dispatch({ type: "ADVANCE_ROUND_ROBIN", payload: { conversationId } })
      }
    },
    [send]
  )

  const simulateAgentReply = useCallback(
    (_conversationId: string, _agentId: string) => {
      // no-op: real replies come through SSE
    },
    []
  )

  const resetSession = useCallback(
    (conversationId: string) => {
      const conv = stateRef.current.conversations.find((c) => c.id === conversationId)
      if (!conv) return

      const agentMemberIds = conv.members.filter((id) => id !== "user")

      // Send "/new" command to each agent -- this is how OpenClaw triggers
      // a real session reset via the auto-reply system, which creates a new
      // session ID, archives the old transcript, and resets context.
      for (const agentId of agentMemberIds) {
        const sessionKey =
          conv.type === "group"
            ? `agent:${agentId}:group:${conversationId}`
            : undefined
        send(agentId, "/new", sessionKey)
      }

      dispatch({ type: "RESET_SESSION", payload: { conversationId } })
    },
    [send]
  )

  const abortConversation = useCallback(
    (conversationId: string) => {
      const conv = stateRef.current.conversations.find((c) => c.id === conversationId)
      if (!conv) return

      const agentMemberIds = conv.members.filter((id) => id !== "user")
      for (const agentId of agentMemberIds) {
        if (!stateRef.current.thinkingAgents.has(agentId)) continue
        const sessionKey =
          conv.type === "group"
            ? `agent:${agentId}:group:${conversationId}`
            : `agent:${agentId}:main`
        window.ipc.chatAbort({ sessionKey })
      }
    },
    []
  )

  const value = useMemo(
    () => ({
      state,
      dispatch,
      sendMessage,
      simulateAgentReply,
      refreshFleet,
      resetSession,
      abortConversation,
      checkModelsConfigured,
      compactingConversationIds,
      compactedConversationIds,
    }),
    [
      state,
      sendMessage,
      simulateAgentReply,
      refreshFleet,
      resetSession,
      abortConversation,
      checkModelsConfigured,
      compactingConversationIds,
      compactedConversationIds,
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within AppProvider")
  return ctx
}
