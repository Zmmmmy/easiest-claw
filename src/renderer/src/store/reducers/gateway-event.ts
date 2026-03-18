import type { AppState } from "../app-types"
import type { GatewayEvent } from "@/hooks/use-openclaw"
import type { Message } from "@/types"
import { extractTextContent, extractAssistantContentBlocks, uniqueId, isRecord, resolveAgentIdFromPayload } from "../app-utils"

export function handleGatewayEvent(state: AppState, event: GatewayEvent): AppState {
  if (event.type !== "gateway.event") return state
  if (!isRecord(event.payload)) {
    console.warn(`[Reducer:GATEWAY_EVENT] payload is not a record: ${typeof event.payload}`)
    return state
  }

  const payload = event.payload
  const eventName = event.event ?? ""

  const agentId = resolveAgentIdFromPayload(payload)
  if (!agentId) {
    // system-presence and similar events don't have agentId — silently ignore
    return state
  }

  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : ""
  const groupMatch = sessionKey.match(/^agent:[^:]+:group:(.+)$/)
  const conversationId = groupMatch ? groupMatch[1] : `conv-${agentId}`

  const makeTimestamp = () =>
    new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })

  const findAgent = () => state.agents.find((a) => a.id === agentId)

  const finalizeStreaming = (): AppState => {
    const next = new Set(state.thinkingAgents)
    next.delete(agentId)
    const updatedAgents = state.agents.map((a) =>
      a.id === agentId ? { ...a, status: "idle" as const } : a
    )

    const existing = state.messages[conversationId] ?? []
    const lastMsg = existing[existing.length - 1]
    let updatedMsgs = existing
    if (lastMsg && lastMsg.id.startsWith("streaming-")) {
      updatedMsgs = [
        ...existing.slice(0, -1),
        { ...lastMsg, id: uniqueId("msg") },
      ]
    }

    const lastContent = updatedMsgs[updatedMsgs.length - 1]?.content ?? ""
    const updatedConvs = state.conversations.map((c) =>
      c.id === conversationId
        ? {
            ...c,
            lastMessage: lastContent.slice(0, 100),
            lastMessageTime: makeTimestamp(),
            unreadCount:
              state.activeConversationId === conversationId ? 0 : c.unreadCount + 1,
          }
        : c
    )

    return {
      ...state,
      thinkingAgents: next,
      agents: updatedAgents,
      messages: { ...state.messages, [conversationId]: updatedMsgs },
      conversations: updatedConvs,
    }
  }

  // OpenClaw "chat" event: {runId, sessionKey, state, message, ...}
  if (eventName === "chat") {
    const chatState = typeof payload.state === "string" ? payload.state : ""
    const role = isRecord(payload.message)
      ? (typeof (payload.message as Record<string, unknown>).role === "string"
          ? (payload.message as Record<string, unknown>).role as string
          : "")
      : ""

    if (role === "user" || role === "system") return state

    // toolResult event: merge result into the last assistant message's contentBlocks
    if (role === "toolResult") {
      const msg = payload.message as Record<string, unknown>
      const toolCallId = typeof msg.toolCallId === "string" ? msg.toolCallId : ""
      const toolName = typeof msg.toolName === "string" ? msg.toolName : ""
      const isError = msg.isError === true
      if (!toolCallId) return state

      const existing = state.messages[conversationId] ?? []
      // Find the last assistant message with contentBlocks
      for (let i = existing.length - 1; i >= 0; i--) {
        const m = existing[i]
        if (m.senderId === "user") break // don't look past the last user message
        if (!m.contentBlocks || m.contentBlocks.length === 0) continue
        const hasMatchingToolCall = m.contentBlocks.some(
          (b) => b.type === "toolCall" && b.id === toolCallId
        )
        if (!hasMatchingToolCall) continue

        const updatedBlocks = m.contentBlocks.map((b) =>
          b.type === "toolCall" && b.id === toolCallId
            ? { ...b, result: { toolCallId, toolName, content: msg.content, isError } }
            : b
        )
        const updatedMsg = { ...m, contentBlocks: updatedBlocks }
        const updatedMsgs = [...existing]
        updatedMsgs[i] = updatedMsg
        return {
          ...state,
          messages: { ...state.messages, [conversationId]: updatedMsgs },
        }
      }
      return state
    }

    if (chatState === "delta") {
      const content = extractTextContent(
        isRecord(payload.message)
          ? (payload.message as Record<string, unknown>).content ?? (payload.message as Record<string, unknown>).text
          : ""
      )
      console.warn(`[Reducer:chat:delta] conversationId=${conversationId} agentId=${agentId} content=${content ? content.slice(0, 40) : "(empty)"}`)
      if (!content) return state

      const next = new Set(state.thinkingAgents)
      next.add(agentId)
      const updatedAgents = state.agents.map((a) =>
        a.id === agentId ? { ...a, status: "thinking" as const } : a
      )

      const withThinking = { ...state, thinkingAgents: next, agents: updatedAgents }
      const existing = withThinking.messages[conversationId] ?? []
      const lastMsg = existing[existing.length - 1]

      // for chat deltas, replace the entire streaming message content (cumulative text)
      if (lastMsg && lastMsg.senderId === agentId && lastMsg.id.startsWith("streaming-")) {
        const updatedMsg = { ...lastMsg, content }
        return {
          ...withThinking,
          messages: { ...withThinking.messages, [conversationId]: [...existing.slice(0, -1), updatedMsg] },
        }
      }

      const agent = findAgent()
      const newMsg: Message = {
        id: uniqueId(`streaming-${agentId}`),
        conversationId,
        senderId: agentId,
        senderName: agent?.name ?? agentId,
        senderAvatar: agent?.avatar ?? agentId.slice(0, 2).toUpperCase(),
        senderRole: agent?.role,
        content,
        timestamp: makeTimestamp(),
        read: state.activeConversationId === conversationId,
        type: "text",
      }
      return {
        ...withThinking,
        messages: { ...withThinking.messages, [conversationId]: [...existing, newMsg] },
      }
    }

    if (chatState === "final") {
      const rawContent = isRecord(payload.message)
        ? (payload.message as Record<string, unknown>).content ?? (payload.message as Record<string, unknown>).text
        : ""
      const content = extractTextContent(rawContent)
      const contentBlocks = extractAssistantContentBlocks(rawContent)
      console.warn(`[Reducer:chat:final] conversationId=${conversationId} content=${content ? content.slice(0, 40) : "(empty)"} blocks=${contentBlocks.length} existingMsgs=${(state.messages[conversationId] ?? []).length} lastMsgId=${state.messages[conversationId]?.at(-1)?.id ?? "none"}`)
      if (content || contentBlocks.length > 0) {
        const existing = state.messages[conversationId] ?? []
        const lastMsg = existing[existing.length - 1]
        if (lastMsg && lastMsg.id.startsWith("streaming-")) {
          const updated: Message = {
            ...lastMsg,
            content,
            id: uniqueId("msg"),
            ...(contentBlocks.length > 0 ? { contentBlocks } : {}),
          }
          const next = new Set(state.thinkingAgents)
          next.delete(agentId)
          const updatedAgents = state.agents.map((a) =>
            a.id === agentId ? { ...a, status: "idle" as const } : a
          )
          const updatedConvs = state.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, lastMessage: content.slice(0, 100), lastMessageTime: makeTimestamp(),
                  unreadCount: state.activeConversationId === conversationId ? 0 : c.unreadCount + 1 }
              : c
          )
          return {
            ...state,
            thinkingAgents: next,
            agents: updatedAgents,
            messages: { ...state.messages, [conversationId]: [...existing.slice(0, -1), updated] },
            conversations: updatedConvs,
          }
        }
      }
      return finalizeStreaming()
    }

    if (chatState === "aborted" || chatState === "error") {
      return finalizeStreaming()
    }

    return state
  }

  // OpenClaw "agent" event: lifecycle events for thinking-state updates only.
  // "chat" events are the UI-facing derived events (delta/final) and already contain
  // the full assistant text. We skip "assistant" stream to avoid duplicate messages.
  if (eventName === "agent") {
    const stream = typeof payload.stream === "string" ? payload.stream : ""
    const data = isRecord(payload.data) ? (payload.data as Record<string, unknown>) : null
    const phase = typeof data?.phase === "string" ? data.phase : ""

    if (stream === "lifecycle") {
      if (phase === "start") {
        const next = new Set(state.thinkingAgents)
        next.add(agentId)
        const updatedAgents = state.agents.map((a) =>
          a.id === agentId ? { ...a, status: "thinking" as const } : a
        )
        return { ...state, thinkingAgents: next, agents: updatedAgents }
      }
      // "end" and "error": only clear thinking state — "chat" final event handles messages.
      if (phase === "end" || phase === "error") {
        const next = new Set(state.thinkingAgents)
        next.delete(agentId)
        return { ...state, thinkingAgents: next }
      }
      return state
    }

    return state
  }

  return state
}
