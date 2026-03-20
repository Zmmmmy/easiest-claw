import type { AppState } from "../app-types"
import type { GatewayEvent } from "@/hooks/use-openclaw"
import type { Message, ContentBlock } from "@/types"
import { extractTextContent, uniqueId, isRecord, resolveAgentIdFromPayload } from "../app-utils"

// Track finalized runIds to prevent duplicate processing (e.g. gateway replays)
// Use a Map<runId, timestamp> so we can skip only events that arrive significantly later
const finalizedRunIds = new Map<string, number>()
const MAX_FINALIZED_IDS = 200
// Grace period: ignore the dedup check for events arriving within this window
// (handles React StrictMode double-invocation of reducers)
const DEDUP_GRACE_MS = 500

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

  // Skip duplicate chat events for already-finalized runs (e.g. gateway replays)
  // Only filter chat events — agent events (lifecycle, tool, compaction) must always be processed
  // Use a grace period to avoid conflicts with React StrictMode double-invocation
  if (runId && eventName === "chat") {
    const finalizedAt = finalizedRunIds.get(runId)
    if (finalizedAt && (Date.now() - finalizedAt) > DEDUP_GRACE_MS) {
      console.log(`[GW-DEDUP] Skipping chat event for finalized runId=${runId} age=${Date.now() - finalizedAt}ms`)
      return state
    }
  }

  const makeTimestamp = () =>
    new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })

  const findAgent = () => state.agents.find((a) => a.id === agentId)

  // ── Helpers to find the streaming message for a given run ──────────────
  const streamingId = runId ? `streaming-${runId}` : ""

  const findStreamingIdx = (msgs: Message[]): number => {
    if (streamingId) {
      return msgs.findLastIndex((m) => m.id === streamingId)
    }
    return -1
  }

  /**
   * Freeze the current streaming text (message.content) into a "text" contentBlock,
   * then clear message.content. This mirrors OpenClaw webui's chatStreamSegments mechanism:
   * each tool-start freezes the accumulated text so far into a segment.
   */
  const freezeContentToBlock = (msg: Message): Message => {
    const text = msg.content?.trim()
    if (!text) return { ...msg, content: "" }
    const blocks: ContentBlock[] = [...(msg.contentBlocks ?? [])]
    // Avoid duplicate: don't freeze if the last block is already this exact text
    const lastBlock = blocks[blocks.length - 1]
    if (lastBlock?.type === "text" && lastBlock.text === text) {
      return { ...msg, content: "" }
    }
    blocks.push({ type: "text", text })
    return { ...msg, content: "", contentBlocks: blocks }
  }

  const finalizeStreaming = (finalContent?: string): AppState => {
    // Mark this run as finalized to prevent duplicate processing
    if (runId) {
      finalizedRunIds.set(runId, Date.now())
      if (finalizedRunIds.size > MAX_FINALIZED_IDS) {
        const first = finalizedRunIds.keys().next().value
        if (first) finalizedRunIds.delete(first)
      }
    }

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
      let msg = existing[streamIdx]

      // If there's trailing content not yet frozen into blocks, freeze it now
      if (msg.content?.trim()) {
        msg = freezeContentToBlock(msg)
      }

      // final content is the full cumulative text for the entire run.
      // If we already have contentBlocks (frozen text segments + tool calls),
      // the text is already captured — don't duplicate it.
      const isNoReply = finalContent === "NO_REPLY"
      const usableFinal = (!isNoReply && finalContent?.trim()) || ""
      if (usableFinal) {
        const blocks: ContentBlock[] = [...(msg.contentBlocks ?? [])]
        if (blocks.length === 0) {
          msg = { ...msg, content: usableFinal }
        } else {
          const textBlocks = blocks
            .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
            .map((b) => b.text)
          if (textBlocks.length === 0) {
            blocks.push({ type: "text", text: usableFinal })
            msg = { ...msg, content: "", contentBlocks: blocks }
          } else {
            const joinedText = textBlocks.join("")
            if (usableFinal.startsWith(joinedText)) {
              const tail = usableFinal.slice(joinedText.length)
              if (tail.trim()) {
                const lastBlock = blocks[blocks.length - 1]
                if (!(lastBlock?.type === "text" && lastBlock.text === tail)) {
                  blocks.push({ type: "text", text: tail })
                  msg = { ...msg, content: "", contentBlocks: blocks }
                }
              }
            }
          }
        }
      }

      updatedMsgs[streamIdx] = { ...msg, id: runId ? `msg-${runId}` : uniqueId("msg") }
    }
    const lastMsg = updatedMsgs[updatedMsgs.length - 1]
    // For lastMessage preview, extract text from contentBlocks or content
    const preview = lastMsg?.contentBlocks?.length
      ? (lastMsg.contentBlocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ") || lastMsg.content)
      : (lastMsg?.content ?? "")
    const updatedConvs = state.conversations.map((c) =>
      c.id === conversationId
        ? { ...c, lastMessage: preview.slice(0, 100), lastMessageTime: makeTimestamp(),
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

    // ── delta: no-op ──────────────────────────────────────────────────────
    // Text streaming is driven by agent/stream=assistant events (precise deltas).
    // chat/delta is a cumulative snapshot — applying it causes duplication.
    // Thinking state is managed by lifecycle/start and lifecycle/end.
    // Message placeholder is created by the first agent/assistant delta.
    if (chatState === "delta") {
      return state
    }

    // ── final: finalize streaming message ────────────────────────────
    if (chatState === "final") {
      const rawContent = isRecord(payload.message)
        ? (payload.message as Record<string, unknown>).content ?? (payload.message as Record<string, unknown>).text : ""
      const content = extractTextContent(rawContent)
      console.log(`[GW-FINAL] runId=${runId} content="${content.slice(0, 50)}" thinkingAgents=[${[...state.thinkingAgents]}]`)
      // "NO_REPLY" is a sentinel value meaning no text response — treat as empty
      const effectiveContent = content === "NO_REPLY" ? "" : content
      return finalizeStreaming(effectiveContent)
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
        // New run starting — clear any stale finalized marker for this runId
        if (runId) finalizedRunIds.delete(runId)
        const next = new Set(state.thinkingAgents)
        next.add(agentId)
        const updatedAgents = state.agents.map((a) =>
          a.id === agentId ? { ...a, status: "thinking" as const } : a
        )
        return { ...state, thinkingAgents: next, agents: updatedAgents }
      }
      if (phase === "end" || phase === "error") {
        console.log(`[GW-LIFECYCLE] ${phase} runId=${runId} agentId=${agentId} thinkingAgents=[${[...state.thinkingAgents]}]`)
        const next = new Set(state.thinkingAgents)
        next.delete(agentId)
        return { ...state, thinkingAgents: next }
      }
      return state
    }

    // ── compaction: no-op in reducer (compaction is handled by app-context) ─
    if (stream === "compaction") {
      return state
    }

    // ── assistant stream: append delta text to streaming message ─────────
    // agent/stream=assistant provides precise per-token deltas; use these
    // to drive text streaming instead of the cumulative chat/delta snapshots.
    if (stream === "assistant" && data) {
      const delta = typeof data.delta === "string" ? data.delta : ""
      if (!delta) return state

      // Skip delta if this run is already finalized (late-arriving deltas after chat/final)
      if (runId && finalizedRunIds.has(runId)) return state

      const existing = state.messages[conversationId] ?? []
      let streamIdx = findStreamingIdx(existing)
      let msgs = existing

      if (streamIdx === -1) {
        // Create streaming message placeholder on first delta
        const agent = findAgent()
        const newMsg: Message = {
          id: streamingId || uniqueId(`streaming-${agentId}`),
          conversationId, senderId: agentId,
          senderName: agent?.name ?? agentId,
          senderAvatar: agent?.avatar ?? agentId.slice(0, 2).toUpperCase(),
          senderRole: agent?.role, content: "", timestamp: makeTimestamp(),
          read: state.activeConversationId === conversationId, type: "text",
        }
        msgs = [...existing, newMsg]
        streamIdx = msgs.length - 1
      }

      const streamMsg = msgs[streamIdx]
      const updatedMsgs = [...msgs]
      updatedMsgs[streamIdx] = { ...streamMsg, content: (streamMsg.content ?? "") + delta }
      return { ...state, messages: { ...state.messages, [conversationId]: updatedMsgs } }
    }

    // ── tool events: inject toolCall blocks into streaming message ────
    // On tool-start, freeze current text into a "text" contentBlock (segment),
    // then add the toolCall block. This produces interleaved text/tool rendering.
    if (stream === "tool" && data) {
      // Skip tool events for already-finalized runs
      if (runId && finalizedRunIds.has(runId)) return state

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

        // Freeze current text content into a text block before adding tool
        let streamMsg = freezeContentToBlock(msgs[streamIdx])
        const blocks: ContentBlock[] = [...(streamMsg.contentBlocks ?? [])]

        // Parse arguments
        let args: Record<string, unknown> = {}
        if (typeof data.args === "string") {
          try { args = JSON.parse(data.args) } catch { args = { raw: data.args } }
        } else if (data.args && typeof data.args === "object") {
          args = data.args as Record<string, unknown>
        }

        // Add thinking block if present
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
