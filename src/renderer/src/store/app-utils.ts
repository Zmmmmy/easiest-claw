import type { Agent, Conversation, ViewType, ChatAttachment, ContentBlock, ToolResultBlock } from "@/types"
import type { AgentSeed, HistoryMessage } from "@/hooks/use-openclaw"

export const extractTextContent = (content: unknown): string => {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object") {
          const rec = part as Record<string, unknown>
          if (rec.type === "text" && typeof rec.text === "string") return rec.text
        }
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

/**
 * 从 OpenClaw 历史消息 content 数组中提取图片块，转为 ChatAttachment。
 * 支持以下格式：
 * 1. Anthropic:  { type: "image", source: { type: "base64", media_type, data } }
 * 2. OpenAI:     { type: "image_url", image_url: { url: "data:..." } }
 * 3. 我们的发送格式（OpenClaw 原样存储时）: { type: "image", mimeType, content }
 */
export const extractImageAttachments = (content: unknown): ChatAttachment[] => {
  if (!Array.isArray(content)) return []
  const results: ChatAttachment[] = []
  for (const part of content) {
    if (!part || typeof part !== "object") continue
    const rec = part as Record<string, unknown>

    if (rec.type === "image") {
      // Anthropic format
      const source = rec.source as Record<string, unknown> | undefined
      if (source?.type === "base64") {
        const mediaType = typeof source.media_type === "string" ? source.media_type : ""
        const data = typeof source.data === "string" ? source.data : ""
        if (mediaType && data) {
          results.push({ id: uniqueId("hist-img"), dataUrl: `data:${mediaType};base64,${data}`, mimeType: mediaType })
        }
        continue
      }
      // Our send format: { type: "image", mimeType, content }
      if (typeof rec.mimeType === "string" && typeof rec.content === "string" && rec.content) {
        results.push({ id: uniqueId("hist-img"), dataUrl: `data:${rec.mimeType};base64,${rec.content}`, mimeType: rec.mimeType })
      }
      continue
    }

    // OpenAI format: { type: "image_url", image_url: { url: "data:..." } }
    if (rec.type === "image_url") {
      const imageUrl = rec.image_url as Record<string, unknown> | undefined
      const url = typeof imageUrl?.url === "string" ? imageUrl.url : ""
      if (url.startsWith("data:")) {
        const mimeType = /^data:([^;]+);/.exec(url)?.[1] ?? "image/jpeg"
        results.push({ id: uniqueId("hist-img"), dataUrl: url, mimeType })
      }
      continue
    }
  }
  return results
}

// Strip the generated hex prefix (e.g. "850cf703-bbb" → "bbb") for agents
// created before the agents.update rename was introduced.
const stripHexPrefix = (raw: string): string =>
  /^[0-9a-f]{8}-(.+)$/i.exec(raw)?.[1] ?? raw

export const agentSeedToAgent = (seed: AgentSeed): Agent => {
  const name = stripHexPrefix(seed.name || seed.agentId)
  return {
    id: seed.agentId,
    name,
    role: "Agent",
    avatar: seed.emoji || name.slice(0, 2).toUpperCase(),
    emoji: seed.emoji,
    skills: [],
    category: "OpenClaw",
    status: "idle",
    lastActiveAt: "",
  }
}

export const agentSeedToConversation = (seed: AgentSeed): Conversation => {
  const name = stripHexPrefix(seed.name || seed.agentId)
  return {
    id: `conv-${seed.agentId}`,
    type: "direct",
    name,
    avatar: seed.emoji || name.slice(0, 2).toUpperCase(),
    members: [seed.agentId],
    lastMessage: "",
    lastMessageTime: "",
    unreadCount: 0,
  }
}

/**
 * 从消息文本中提取 [本地文件] 块，还原为 ChatAttachment[]。
 * 发送时格式：  message\n\n[本地文件]\n/path1\n/path2
 */
export const extractFileAttachments = (text: string): ChatAttachment[] => {
  const marker = "[本地文件]"
  const idx = text.indexOf(marker)
  if (idx === -1) return []
  const pathBlock = text.slice(idx + marker.length).trim()
  if (!pathBlock) return []
  return pathBlock
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((filePath) => ({
      id: uniqueId("hist-file"),
      filePath,
      mimeType: "application/octet-stream",
      fileName: filePath.split(/[/\\]/).pop(),
    }))
}

/**
 * 从消息文本中移除 [本地文件] 块，返回纯消息内容。
 */
export const stripFileAttachmentBlock = (text: string): string => {
  const marker = "[本地文件]"
  const idx = text.indexOf(marker)
  if (idx === -1) return text
  return text.slice(0, idx).trimEnd()
}

/**
 * 从 assistant 消息的 content 数组中提取结构化内容块。
 * 支持 text / thinking / toolCall 类型。
 * 仅当存在非 text 块时才返回非空数组（纯文本消息不需要结构化渲染）。
 */
export const extractAssistantContentBlocks = (content: unknown): ContentBlock[] => {
  if (!Array.isArray(content)) return []
  const blocks: ContentBlock[] = []
  let hasNonText = false

  for (const part of content) {
    if (!part || typeof part !== "object") continue
    const rec = part as Record<string, unknown>

    if (rec.type === "text" && typeof rec.text === "string" && rec.text.trim()) {
      blocks.push({ type: "text", text: rec.text })
      continue
    }

    if (rec.type === "thinking" && typeof rec.thinking === "string") {
      hasNonText = true
      blocks.push({
        type: "thinking",
        thinking: rec.thinking,
        ...(rec.redacted ? { redacted: true } : {}),
      })
      continue
    }

    if (rec.type === "toolCall" && typeof rec.name === "string") {
      hasNonText = true
      blocks.push({
        type: "toolCall",
        id: typeof rec.id === "string" ? rec.id : "",
        name: rec.name,
        arguments: isRecord(rec.arguments) ? rec.arguments : {},
      })
      continue
    }
  }

  return hasNonText ? blocks : []
}

/**
 * 从 toolResult 消息中提取结果块。
 */
export const extractToolResult = (msg: HistoryMessage): ToolResultBlock | null => {
  if (msg.role !== "toolResult") return null
  const rec = msg.content as Record<string, unknown> | unknown
  const raw = msg as unknown as Record<string, unknown>
  return {
    toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : "",
    toolName: typeof raw.toolName === "string" ? raw.toolName : "",
    content: rec,
    isError: raw.isError === true,
  }
}

/**
 * 将连续的 assistant + toolResult 消息合并为带有 result 的 contentBlocks。
 * 返回最终的 ContentBlock[] 供 assistant 消息使用。
 */
export const mergeToolResults = (
  blocks: ContentBlock[],
  toolResults: ToolResultBlock[]
): ContentBlock[] => {
  if (toolResults.length === 0) return blocks
  const resultMap = new Map<string, ToolResultBlock>()
  for (const tr of toolResults) {
    resultMap.set(tr.toolCallId, tr)
  }
  return blocks.map((block) => {
    if (block.type !== "toolCall") return block
    const result = resultMap.get(block.id)
    return result ? { ...block, result } : block
  })
}

let _idCounter = 0
export const uniqueId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${(++_idCounter).toString(36)}`

export const VALID_VIEWS: ViewType[] = ["chat", "virtual-team", "cron", "openclaw", "skills", "agent-config", "channels", "plugins"]

export const parseViewFromHash = (): ViewType => {
  if (typeof window === "undefined") return "chat"
  const hash = window.location.hash.replace("#", "")
  return VALID_VIEWS.includes(hash as ViewType) ? (hash as ViewType) : "chat"
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value))

export const resolveAgentIdFromPayload = (payload: Record<string, unknown>): string | null => {
  if (typeof payload.agentId === "string" && payload.agentId.trim()) {
    return payload.agentId.trim()
  }
  if (typeof payload.sessionKey === "string") {
    const match = payload.sessionKey.match(/^agent:([^:]+):/)
    if (match) return match[1]
  }
  return null
}
