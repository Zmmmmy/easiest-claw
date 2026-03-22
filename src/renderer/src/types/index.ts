export type AgentStatus = "idle" | "working" | "busy" | "chatting" | "thinking" | "completed"

export type OrchestrationStrategy = "all" | "skill-match" | "coordinator" | "round-robin"

export interface GroupOrchestration {
  strategy: OrchestrationStrategy
  coordinatorId?: string
  maxResponders?: number
  roundRobinIndex?: number
}

export interface OrchestrationInfo {
  strategy: OrchestrationStrategy
  selectedAgents: string[]
  reason: string
}

export interface Agent {
  id: string
  name: string
  role: string
  avatar: string
  emoji?: string
  skills: string[]
  category: string
  status: AgentStatus
  currentTask?: string
  taskProgress?: number
  lastActiveAt: string
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; redacted?: boolean }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown>; result?: ToolResultBlock }
  | { type: "toolResult"; toolCallId: string; toolName: string; content: unknown; isError: boolean }

export interface ToolResultBlock {
  toolCallId: string
  toolName: string
  content: unknown
  isError: boolean
}

export interface Message {
  id: string
  conversationId: string
  senderId: string | "user"
  senderName: string
  senderAvatar: string
  senderRole?: string
  content: string
  timestamp: string
  read: boolean
  type: "text" | "system" | "task-card" | "file" | "orchestration"
  taskCard?: TaskCard
  fileAttachment?: FileAttachment
  attachments?: ChatAttachment[]
  contentBlocks?: ContentBlock[]
  mentions?: string[]
  orchestrationInfo?: OrchestrationInfo
}

export interface TaskCard {
  title: string
  progress: number
  scope: string
  status: "in-progress" | "completed" | "failed"
}

export interface FileAttachment {
  name: string
  size: string
  type: string
}

export interface Conversation {
  id: string
  type: "direct" | "group"
  name: string
  avatar: string
  purpose?: string
  members: string[]
  orchestration?: GroupOrchestration
  workspacePath?: string
  lastMessage?: string
  lastMessageSender?: string
  lastMessageTime: string
  unreadCount: number
  pinned?: boolean
  pinnedAt?: number
}

export interface ChatAttachment {
  id: string
  dataUrl?: string
  filePath?: string
  mimeType: string
  fileName?: string
}

export type ViewType = "chat" | "virtual-team" | "cron" | "openclaw" | "skills" | "agent-config" | "channels" | "plugins"
