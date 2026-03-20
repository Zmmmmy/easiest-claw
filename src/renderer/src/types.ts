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
  workspacePath?: string
  members: string[]
  orchestration?: GroupOrchestration
  lastMessage?: string
  lastMessageSender?: string
  lastMessageTime: string
  unreadCount: number
  pinned?: boolean
  pinnedAt?: number
}

export interface ChatAttachment {
  id: string
  dataUrl?: string      // 图片专用：base64 data URL；非图片文件不存在此字段
  filePath?: string     // 非图片文件专用：Electron 本地绝对路径
  mimeType: string
  fileName?: string
}

export type ViewType = "chat" | "virtual-team" | "cron" | "openclaw" | "skills" | "agent-config" | "channels" | "plugins"
