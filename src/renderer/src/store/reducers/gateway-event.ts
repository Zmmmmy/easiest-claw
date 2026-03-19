import type { AppState } from "../app-types"
import type { GatewayEvent } from "@/hooks/use-openclaw"
import type { Message, ContentBlock } from "@/types"
import { extractTextContent, uniqueId, isRecord, resolveAgentIdFromPayload } from "../app-utils"

export function handleGatewayEvent(state: AppState, event: GatewayEvent): AppState {
  if (event.type !== "gateway.event") return state
  if (!isRecord(event.payload)) return state

  const payload = event.payload
  const eventName = event.event ?? ""

  const agentId = resolveAgentIdFromPayload(payload)
  if (!agentId) return state

  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : ""
  const groupMatch = sessionKey.match(/^agent:[^:]+:group:(.+)$/)
  const conversationId = groupMatch ? groupMatch[1] : `conv-${agentId}`
  const runId = typeof payload.runId === "string" ? payload.runId : ""

  const makeTimestamp = () =>
    new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })

  const findAgent = () => state.agents.find((a) => a.id === agentId)

  // ── Helpers to find the streaming message for a given run ──────────────
  const streamingId = runId ? `streaming-${runId}` : ""

  const findStreamingIdx = (msgs: Message[]): number => {
    // Primary: match by runId-based streaming ID
    if (streamingId) {
      const idx = msgs.findLastIndex((m) => m.id === streamingId)
      if (idx !== -1) return idx
    }
    // Fallback: match any streaming message from this agent
    return msgs.findLastIndex(
      (m) => m.senderId === agentId && m.id.startsWith("streaming-")
    )
  }

  const finalizeStreaming = (): AppState => {
    const next = new Set(state.thinkingAgents)
    next.delete(agentId)
    const updatedAgents = state.agents.map((a) =>
      a.id === agentId ? { ...a, status: "idle" as const } : a
    )
    const existing = state.messages[conversationId] ?? []
    const streamIdx = findStreamingIdx(existing)
    let updatedMsgs = existing
    if (streamIdx !== -1) {
      updatedMsgs = [...existing]
      updatedMsgs[streamIdx] = { ...existing[streamIdx], id: uniqueId("msg") }
    }
    const lastContent = updatedMsgs[updatedMsgs.length - 1]?.content ?? ""
    const updatedConvs = state.conversations.map((c) =>
      c.id === conversationId
        ? { ...c, lastMessage: lastContent.slice(0, 100), lastMessageTime: makeTimestamp(),
            unreadCount: state.activeConversationId === conversationId ? 0 : c.unreadCount + 1 }
        : c
    )
    return { ...state, thinkingAgents: next, agents: updatedAgents,
      messages: { ...state.messages, [conversationId]: updatedMsgs }, conversations: updatedConvs }
  }

  // ══════════════════════════════════════════════════════════════════════
  // "chat" events: delta / final / toolResult
  // ══════════════════════════════════════════════════════════════════════
  if (eventName === "chat") {
    const chatState = typeof payload.state === "string" ? payload.state : ""
    const role = isRecord(payload.message)
      ? (typeof (payload.message as Record<string, unknown>).role === "string"
          ? (payload.message as Record<string, unknown>).role as string : "")
      : ""

    if (role === "user" || role === "system") return state

    // ── toolResult: patch into streaming message's contentBlocks ──────
    if (role === "toolResult") {
      const msg = payload.message as Record<string, unknown>
      const toolCallId = typeof msg.toolCallId === "string" ? msg.toolCallId : ""
      const toolName = typeof msg.toolName === "string" ? msg.toolName : ""
      const isError = msg.isError === true
      if (!toolCallId) return state

      const existing = state.messages[conversationId] ?? []
      for (let i = existing.length - 1; i >= 0; i--) {
        const m = existing[i]
        if (m.senderId === "user") break
        if (!m.contentBlocks || m.contentBlocks.length === 0) continue
        const hasMatch = m.contentBlocks.some((b) => b.type === "toolCall" && b.id === toolCallId)
        if (!hasMatch) continue
        const updatedBlocks = m.contentBlocks.map((b) =>
          b.type === "toolCall" && b.id === toolCallId
            ? { ...b, result: { toolCallId, toolName, content: msg.content, isError } } : b
        )
        const updatedMsgs = [...existing]
        updatedMsgs[i] = { ...m, contentBlocks: updatedBlocks }
        return { ...state, messages: { ...state.messages, [conversationId]: updatedMsgs } }
      }
      return state
    }

    // ── delta: cumulative text update ─────────────────────────────────
    if (chatState === "delta") {
      const rawContent = isRecord(payload.message)
        ? (payload.message as Record<string, unknown>).content ?? (payload.message as Record<string, unknown>).text : ""
      const content = extractTextContent(rawContent)
      if (!content) return state

      const next = new Set(state.thinkingAgents)
      next.add(agentId)
      const updatedAgents = state.agents.map((a) =>
        a.id === agentId ? { ...a, status: "thinking" as const } : a
      )
      const withThinking = { ...state, thinkingAgents: next, agents: updatedAgents }
      const existing = withThinking.messages[conversationId] ?? []
      const streamIdx = findStreamingIdx(existing)

      if (streamIdx !== -1) {
        // Update text, preserve existing contentBlocks (tool calls added by agent events)
        const updatedMsgs = [...existing]
        updatedMsgs[streamIdx] = { ...existing[streamIdx], content }
        return { ...withThinking, messages: { ...withThinking.messages, [conversationId]: updatedMsgs } }
      }

      // Create new streaming message
      const agent = findAgent()
      const newMsg: Message = {
        id: streamingId || uniqueId(`streaming-${agentId}`),
        conversationId, senderId: agentId,
        senderName: agent?.name ?? agentId,
        senderAvatar: agent?.avatar ?? agentId.slice(0, 2).toUpperCase(),
        senderRole: agent?.role, content, timestamp: makeTimestamp(),
        read: state.activeConversationId === conversationId, type: "text",
      }
      return { ...withThinking, messages: { ...withThinking.messages, [conversationId]: [...existing, newMsg] } }
    }

    // ── final: finalize streaming message, keep accumulated contentBlocks ─
    if (chatState === "final") {
      const rawContent = isRecord(payload.message)
        ? (payload.message as Record<string, unknown>).content ?? (payload.message as Record<string, unknown>).text : ""
      const content = extractTextContent(rawContent)

      const existing = state.messages[conversationId] ?? []
      const streamIdx = findStreamingIdx(existing)

      if (streamIdx !== -1) {
        // Preserve contentBlocks that were accumulated via tool events during streaming
        const streamMsg = existing[streamIdx]
        const updated: Message = {
          ...streamMsg,
          id: uniqueId("msg"),
          ...(content ? { content } : {}),
        }
        const next = new Set(state.thinkingAgents)
        next.delete(agentId)
        const updatedAgents = state.agents.map((a) =>
          a.id === agentId ? { ...a, status: "idle" as const } : a
        )
        const updatedMsgs = [...existing]
        updatedMsgs[streamIdx] = updated
        const updatedConvs = state.conversations.map((c) =>
          c.id === conversationId
            ? { ...c, lastMessage: (content || streamMsg.content).slice(0, 100),
                lastMessageTime: makeTimestamp(),
                unreadCount: state.activeConversationId === conversationId ? 0 : c.unreadCount + 1 }
            : c
        )
        return { ...state, thinkingAgents: next, agents: updatedAgents,
          messages: { ...state.messages, [conversationId]: updatedMsgs }, conversations: updatedConvs }
      }
      return finalizeStreaming()
    }

    if (chatState === "aborted" || chatState === "error") {
      return finalizeStreaming()
    }

    return state
  }

  // ══════════════════════════════════════════════════════════════════════
  // "agent" events: lifecycle + tool streams
  // ══════════════════════════════════════════════════════════════════════
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
      if (phase === "end" || phase === "error") {
        const next = new Set(state.thinkingAgents)
        next.delete(agentId)
        return { ...state, thinkingAgents: next }
      }
      return state
    }

    // ── tool events: inject toolCall blocks into streaming message ────
    if (stream === "tool" && data) {
      const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : ""
      const toolName = typeof data.name === "string" ? data.name : ""

      if (phase === "start" && toolCallId && toolName) {
        const existing = state.messages[conversationId] ?? []
        let streamIdx = findStreamingIdx(existing)
        let msgs = existing

        // If no streaming message exists yet, create one
        if (streamIdx === -1) {
          const agent = findAgent()
          const newMsg: Message = {
            id: streamingId || uniqueId(`streaming-${agentId}`),
            conversationId, senderId: agentId,
            senderName: agent?.name ?? agentId,
            senderAvatar: agent?.avatar ?? agentId.slice(0, 2).toUpperCase(),
            senderRole: agent?.role, content: "", timestamp: makeTimestamp(),
            read: state.activeConversationId === conversationId, type: "text",
            contentBlocks: [],
          }
          msgs = [...existing, newMsg]
          streamIdx = msgs.length - 1
        }

        const streamMsg = msgs[streamIdx]
        const blocks: ContentBlock[] = [...(streamMsg.contentBlocks ?? [])]

        // Parse arguments from data.args (may be string or object)
        let args: Record<string, unknown> = {}
        if (typeof data.args === "string") {
          try { args = JSON.parse(data.args) } catch { args = { raw: data.args } }
        } else if (data.args && typeof data.args === "object") {
          args = data.args as Record<string, unknown>
        }

        // Add thinking block from data.text if present and no thinking block yet
        const thinkingText = typeof data.text === "string" ? data.text.trim() : ""
        if (thinkingText && !blocks.some((b) => b.type === "thinking")) {
          blocks.push({ type: "thinking", thinking: thinkingText })
        }

        // Avoid duplicate toolCall blocks
        if (!blocks.some((b) => b.type === "toolCall" && b.id === toolCallId)) {
          blocks.push({ type: "toolCall", id: toolCallId, name: toolName, arguments: args })
        }

        const updatedMsgs = [...msgs]
        updatedMsgs[streamIdx] = { ...streamMsg, contentBlocks: blocks }
        return { ...state, messages: { ...state.messages, [conversationId]: updatedMsgs } }
      }

      // tool end with result — patch result into the matching toolCall block
      if (phase === "end" && toolCallId) {
        const existing = state.messages[conversationId] ?? []
        for (let i = existing.length - 1; i >= 0; i--) {
          const m = existing[i]
          if (m.senderId === "user") break
          if (!m.contentBlocks) continue
          const hasMatch = m.contentBlocks.some((b) => b.type === "toolCall" && b.id === toolCallId)
          if (!hasMatch) continue
          const isError = data.isError === true
          const updatedBlocks = m.contentBlocks.map((b) =>
            b.type === "toolCall" && b.id === toolCallId
              ? { ...b, result: { toolCallId, toolName, content: data.result ?? data.text ?? "", isError } } : b
          )
          const updatedMsgs = [...existing]
          updatedMsgs[i] = { ...m, contentBlocks: updatedBlocks }
          return { ...state, messages: { ...state.messages, [conversationId]: updatedMsgs } }
        }
      }

      return state
    }

    return state
  }

  return state
}
