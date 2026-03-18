


import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
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
import { uniqueId, parseViewFromHash, extractTextContent, extractImageAttachments } from "./app-utils"
import { saveAttachmentCacheDb, getAttachmentCacheDb } from "@/lib/db"
import { toast } from "sonner"

function buildWorkspacePrompt(workspacePath: string, content: string): string {  return [
    `【共享工作区 - 重要】`,
    `本次任务在多智能体协作项目中进行，请严格遵守以下规则：`,
    `1. 你的工作目录是：${workspacePath}`,
    `2. 所有文件读写操作必须在此目录下进行，禁止使用你的默认工作区`,
    `3. 这是一个共享工作区，其他团队成员也在此目录下协作`,
    `4. 请保持文件组织清晰，避免覆盖他人的工作成果`,
    `---`,
    content,
  ].join('\n')
}

/** 在 dispatch LOAD_HISTORY 前，异步预取 IndexedDB 附件缓存（OpenClaw 会剥离超限图片）*/
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

  const compactionToastRef = useRef<string | number | null>(null)
  const compactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleEvent = useCallback((event: GatewayEvent) => {
    // Detect compaction events and show toast notifications
    if (event.type === "gateway.event" && event.event === "agent") {
      const payload = event.payload as Record<string, unknown> | undefined
      if (payload && payload.stream === "compaction") {
        const data = payload.data as Record<string, unknown> | undefined
        if (data?.phase === "start") {
          // Clear any previous compaction toast/timer
          if (compactionToastRef.current != null) {
            toast.dismiss(compactionToastRef.current)
          }
          if (compactionTimerRef.current) {
            clearTimeout(compactionTimerRef.current)
          }
          compactionToastRef.current = toast.loading("正在压缩上下文...", {
            duration: 10_000,
            description: "历史消息将被摘要化以节省 token",
          })
          // Auto-dismiss after 10s in case "end" event is missed
          compactionTimerRef.current = setTimeout(() => {
            if (compactionToastRef.current != null) {
              toast.dismiss(compactionToastRef.current)
              compactionToastRef.current = null
            }
            compactionTimerRef.current = null
          }, 10_000)
        } else if (data?.phase === "end" || data?.phase === "error") {
          if (compactionTimerRef.current) {
            clearTimeout(compactionTimerRef.current)
            compactionTimerRef.current = null
          }
          if (compactionToastRef.current != null) {
            toast.dismiss(compactionToastRef.current)
            compactionToastRef.current = null
          }
          toast.info("上下文已压缩", {
            description: "早期消息已被摘要替代，可在「历史会话」中查看完整记录",
            duration: 5000,
          })
        }
      }
    }
    dispatch({ type: "GATEWAY_EVENT", payload: event })
  }, [])

  // 定义在 useRuntimeEventStream 之前，以便 status useEffect 能引用
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
      // IPC not ready yet, keep default (true) to avoid flash
    }
  }, [])

  const { status, connect } = useRuntimeEventStream(handleEvent)

  const prevStatusRef = useRef<ConnectionStatus>('disconnected')
  const fleetRetryRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    dispatch({ type: "SET_CONNECTION_STATUS", payload: status })

    // gateway 每次从非连接状态切换到 connected 时，自动刷新 agent 列表和历史记录
    if (status === 'connected' && prevStatusRef.current !== 'connected') {
      refreshFleet()
      checkModelsConfigured()

      // Agent 列表可能因 gateway 尚未就绪而为空，每秒重试一次，最多 20 秒
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

    // 断开连接时清理重试
    if (status !== 'connected' && fleetRetryRef.current) {
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
      // Skip messages loaded from storage at startup — they were already handled in a previous session
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
        .join("\u3001")
      dispatch({
        type: "ADD_ORCHESTRATION_MESSAGE",
        payload: {
          conversationId: conv.id,
          strategy: "coordinator",
          selectedAgents: mentionedIds,
          reason: `\u534f\u8c03\u4eba\u5df2\u5206\u6d3e \u2192 ${names}`,
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
            senderName: "\u7cfb\u7edf",
            senderAvatar: "SY",
            content: `\u53d1\u9001\u5931\u8d25: ${error}`,
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
            sendError(`${agent?.name ?? agentMemberIds[0]}: ${(result as { error?: string }).error ?? "\u672a\u77e5\u9519\u8bef"}`)
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
              sendError(`${agent?.name ?? agentId}: ${(result as { error?: string }).error ?? "\u672a\u77e5\u9519\u8bef"}`)
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
    () => ({ state, dispatch, sendMessage, simulateAgentReply, refreshFleet, resetSession, abortConversation, checkModelsConfigured }),
    [state, sendMessage, simulateAgentReply, refreshFleet, resetSession, abortConversation, checkModelsConfigured]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within AppProvider")
  return ctx
}
