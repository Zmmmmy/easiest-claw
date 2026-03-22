import type { Message, ToolResultBlock } from "@/types"
import type { AppState, AppAction } from "../app-types"
import { extractTextContent, extractImageAttachments, extractFileAttachments, stripFileAttachmentBlock, extractAssistantContentBlocks, extractToolResult, mergeToolResults, uniqueId } from "../app-utils"
import { stripSenderMetadata, stripUiMetadata } from "@/lib/text/message-extract"
import { handleGatewayEvent } from "./gateway-event"

export function handleChatAction(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case "SEND_MESSAGE": {
      const { conversationId, content, attachments } = action.payload
      const newMsg: Message = {
        id: uniqueId("msg"),
        conversationId,
        senderId: "user",
        senderName: "\u6211",
        senderAvatar: "ZK",
        content,
        timestamp: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        read: true,
        type: "text",
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      }
      const existing = state.messages[conversationId] ?? []
      const updatedConvs = state.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, lastMessage: content, lastMessageTime: newMsg.timestamp }
          : c
      )
      return {
        ...state,
        messages: { ...state.messages, [conversationId]: [...existing, newMsg] },
        conversations: updatedConvs,
      }
    }
    case "ADD_AGENT_MESSAGE": {
      const msg = action.payload
      const existing = state.messages[msg.conversationId] ?? []
      const updatedConvs = state.conversations.map((c) =>
        c.id === msg.conversationId
          ? {
              ...c,
              lastMessage: msg.content.slice(0, 100),
              lastMessageSender: msg.senderName,
              lastMessageTime: msg.timestamp,
              unreadCount:
                state.activeConversationId === msg.conversationId
                  ? 0
                  : c.unreadCount + 1,
            }
          : c
      )
      return {
        ...state,
        messages: { ...state.messages, [msg.conversationId]: [...existing, msg] },
        conversations: updatedConvs,
      }
    }
    case "SET_THINKING": {
      const next = new Set(state.thinkingAgents)
      if (action.payload.thinking) {
        next.add(action.payload.agentId)
      } else {
        next.delete(action.payload.agentId)
      }
      return { ...state, thinkingAgents: next }
    }
    case "APPEND_STREAMING_CONTENT": {
      const { conversationId, messageId, delta } = action.payload
      const existing = state.messages[conversationId] ?? []
      const idx = existing.findIndex((m) => m.id === messageId)
      if (idx === -1) return state
      const updatedMsg = { ...existing[idx], content: existing[idx].content + delta }
      const updatedMsgs = [...existing]
      updatedMsgs[idx] = updatedMsg
      return {
        ...state,
        messages: { ...state.messages, [conversationId]: updatedMsgs },
      }
    }
    case "LOAD_HISTORY": {
      const { conversationId, agentId, messages: historyMessages, attachmentOverrides } = action.payload
      const agent = state.agents.find((a) => a.id === agentId)
      const isInternalMessage = (content: string) =>
        content.startsWith("A new session was started via") ||
        content.startsWith("Execute your Session Startup") ||
        content.startsWith("I'll read the required session startup")

      // First pass: build messages and collect toolResults keyed by preceding assistant index
      const converted: Message[] = []
      // Map from converted array index → pending toolResult blocks to merge
      const pendingToolResults = new Map<number, ToolResultBlock[]>()
      // Track which original index maps to which attachmentOverrides index
      let userAssistantIdx = 0

      for (const m of historyMessages) {
        if (m.role === "toolResult") {
          // Attach to the last assistant message
          const lastIdx = converted.length - 1
          if (lastIdx >= 0 && converted[lastIdx].senderId !== "user") {
            const existing = pendingToolResults.get(lastIdx) ?? []
            const tr = extractToolResult(m)
            if (tr) existing.push(tr)
            pendingToolResults.set(lastIdx, existing)
          }
          continue
        }

        if (m.role === "system") continue
        if (m.role !== "user" && m.role !== "assistant") continue

        const isUser = m.role === "user"
        const currentFilteredIdx = userAssistantIdx++
        const rawText = extractTextContent(m.content)
        const stripped = isUser ? stripSenderMetadata(stripUiMetadata(rawText)) : rawText
        const content = isUser ? stripFileAttachmentBlock(stripped) : stripped
        const fileAtts = isUser ? extractFileAttachments(rawText) : []
        const extractedAtts = isUser ? extractImageAttachments(m.content) : []
        const imageAtts = extractedAtts.length > 0
          ? extractedAtts
          : (attachmentOverrides?.[currentFilteredIdx] ?? [])
        const attachments = [...imageAtts, ...fileAtts]
        const contentBlocks = !isUser ? extractAssistantContentBlocks(m.content) : []
        const ts = m.timestamp
          ? new Date(m.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
          : ""

        const msg: Message = {
          id: uniqueId("hist"),
          conversationId,
          senderId: isUser ? "user" : agentId,
          senderName: isUser ? "\u6211" : (agent?.name ?? agentId),
          senderAvatar: isUser ? "ZK" : (agent?.avatar ?? agentId.slice(0, 2).toUpperCase()),
          senderRole: isUser ? undefined : agent?.role,
          // If contentBlocks exist, content is redundant (already split into blocks)
          content: contentBlocks.length > 0 ? "" : content,
          timestamp: ts,
          read: true,
          type: "text" as const,
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(contentBlocks.length > 0 ? { contentBlocks } : {}),
        }

        if (msg.content.trim() || (msg.attachments && msg.attachments.length > 0) || (msg.contentBlocks && msg.contentBlocks.length > 0)) {
          if (!isInternalMessage(msg.content.trim())) {
            converted.push(msg)
          }
        }
      }

      // Second pass: merge toolResults into their assistant message's contentBlocks
      for (const [idx, toolResults] of pendingToolResults) {
        const msg = converted[idx]
        if (!msg || !msg.contentBlocks || msg.contentBlocks.length === 0) continue
        converted[idx] = { ...msg, contentBlocks: mergeToolResults(msg.contentBlocks, toolResults) }
      }

      if (converted.length === 0) return state

      // Only keep in-progress streaming messages (streaming- prefix).
      // Finalized messages (msg- prefix) are already included in `converted` from history.
      // lifecycle/end no longer triggers LOAD_HISTORY, so there is no race condition.
      const existing = state.messages[conversationId] ?? []
      const streamingMsgs = existing.filter((m) => m.id.startsWith("streaming-"))

      // If there are active streaming messages, skip loading history to avoid
      // showing the same message twice (history version + streaming version).
      if (streamingMsgs.length > 0) return state

      const lastMsg = converted[converted.length - 1]
      const lastMsgPreview = lastMsg.contentBlocks && lastMsg.contentBlocks.length > 0
        ? lastMsg.contentBlocks.filter((b) => b.type === "text").map((b) => (b as { type: "text"; text: string }).text).join(" ")
        : lastMsg.content
      const updatedConvs = state.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, lastMessage: lastMsgPreview.slice(0, 100), lastMessageTime: lastMsg.timestamp }
          : c
      )
      return {
        ...state,
        messages: { ...state.messages, [conversationId]: converted },
        conversations: updatedConvs,
      }
    }
    case "GATEWAY_EVENT":
      return handleGatewayEvent(state, action.payload)
    default:
      return null
  }
}
