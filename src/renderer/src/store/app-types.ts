import type { Agent, ChatAttachment, Conversation, GroupOrchestration, Message, ViewType } from "@/types"
import type { AgentSeed, ConnectionStatus, GatewayEvent, HistoryMessage } from "@/hooks/use-openclaw"

export interface AppState {
  view: ViewType
  agents: Agent[]
  conversations: Conversation[]
  messages: Record<string, Message[]>
  activeConversationId: string | null
  thinkingAgents: Set<string>
  connectionStatus: ConnectionStatus
  gatewayConnected: boolean
  mainAgentId: string | null
  modelsConfigured: boolean
}

export type AppAction =
  | { type: "SET_VIEW"; payload: ViewType }
  | { type: "SET_ACTIVE_CONVERSATION"; payload: string | null }
  | { type: "SEND_MESSAGE"; payload: { conversationId: string; content: string; attachments?: ChatAttachment[] } }
  | { type: "ADD_AGENT_MESSAGE"; payload: Message }
  | { type: "SET_THINKING"; payload: { agentId: string; thinking: boolean } }
  | { type: "CREATE_CONVERSATION"; payload: Conversation }
  | { type: "MARK_READ"; payload: string }
  | { type: "UPDATE_AGENT_STATUS"; payload: { agentId: string; status: Agent["status"] } }
  | { type: "SET_CONNECTION_STATUS"; payload: ConnectionStatus }
  | { type: "SET_FLEET"; payload: { seeds: AgentSeed[]; mainAgentId: string | null } }
  | { type: "APPEND_STREAMING_CONTENT"; payload: { conversationId: string; messageId: string; delta: string } }
  | { type: "GATEWAY_EVENT"; payload: GatewayEvent }
  | { type: "LOAD_HISTORY"; payload: { conversationId: string; agentId: string; messages: HistoryMessage[]; attachmentOverrides?: ChatAttachment[][] } }
  | { type: "LOAD_GROUPS"; payload: Conversation[] }
  | { type: "LOAD_GROUP_MESSAGES"; payload: Record<string, Message[]> }
  | { type: "UPDATE_GROUP_ORCHESTRATION"; payload: { conversationId: string; orchestration: GroupOrchestration } }
  | { type: "ADD_ORCHESTRATION_MESSAGE"; payload: { conversationId: string; strategy: string; selectedAgents: string[]; reason: string } }
  | { type: "ADVANCE_ROUND_ROBIN"; payload: { conversationId: string } }
  | { type: "DISSOLVE_GROUP"; payload: { conversationId: string } }
  | { type: "RESET_SESSION"; payload: { conversationId: string } }
  | { type: "RENAME_AGENT"; payload: { agentId: string; name: string; emoji?: string } }
  | { type: "ADD_AGENT"; payload: { agentId: string; name: string; emoji?: string } }
  | { type: "REMOVE_AGENT"; payload: { agentId: string } }
  | { type: "ADD_GROUP_MEMBER"; payload: { conversationId: string; agentId: string } }
  | { type: "TOGGLE_PIN"; payload: { conversationId: string } }
  | { type: "SET_MODELS_CONFIGURED"; payload: boolean }

export const initialState: AppState = {
  view: "chat",
  agents: [],
  conversations: [],
  messages: {},
  activeConversationId: null,
  thinkingAgents: new Set(),
  connectionStatus: "connecting",
  gatewayConnected: false,
  mainAgentId: null,
  modelsConfigured: true,
}

export interface AppContextValue {
  state: AppState
  dispatch: React.Dispatch<AppAction>
  sendMessage: (conversationId: string, content: string, attachments?: ChatAttachment[]) => void
  simulateAgentReply: (conversationId: string, agentId: string) => void
  refreshFleet: () => Promise<void>
  resetSession: (conversationId: string) => void
  abortConversation: (conversationId: string) => void
  checkModelsConfigured: () => Promise<void>
  compactingConversationIds: Set<string>
  compactedConversationIds: Set<string>
}
