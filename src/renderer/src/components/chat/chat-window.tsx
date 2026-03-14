

import { useCallback, useEffect, useRef, useState } from "react"
import { Activity, Loader2, WifiOff } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { useAvatarVersion } from "@/lib/avatar"
import { useApp } from "@/store/app-context"
import { ChatHeader } from "./chat-header"
import { MessageBubble } from "./message-bubble"
import { MessageInput } from "./message-input"
import { TypingIndicator } from "./typing-indicator"
import { GroupMembersPanel } from "./group-members-panel"
import { PersonaPanel } from "@/components/persona/persona-panel"
import { useI18n } from "@/i18n"
import type { Message } from "@/types"

function formatDateSeparator(
  dateStr: string,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  const now = new Date()
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return ""
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (isToday) return t("chatWindow.today")
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  if (isYesterday) return t("chatWindow.yesterday")
  return t("chatWindow.fullDate", {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  })
}

function getDateKey(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-3">
      <span className="text-[11px] text-muted-foreground/60 bg-muted/50 px-3 py-0.5 rounded-full">
        {label}
      </span>
    </div>
  )
}

export function ChatWindow() {
  const { state, dispatch, sendMessage, resetSession, abortConversation } = useApp()
  const { t } = useI18n()
  useAvatarVersion() // re-render when avatar changes
  const [showMembers, setShowMembers] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [personaPanelOpen, setPersonaPanelOpen] = useState(false)
  const [personaAgentId, setPersonaAgentId] = useState("")
  const [personaAgentName, setPersonaAgentName] = useState("")

  // ── 输入区高度拖拽 ──────────────────────────────────────────────────────────
  const MIN_INPUT_HEIGHT = 88
  const MIN_INPUT_HEIGHT_WITH_ATTACHMENT = 210
  const DEFAULT_INPUT_HEIGHT = 140
  const [panelHeight, setPanelHeight] = useState(DEFAULT_INPUT_HEIGHT)
  // 用 ref 跟踪最新值，避免 useCallback([], ...) 的陈旧闭包问题
  const panelHeightRef = useRef(DEFAULT_INPUT_HEIGHT)
  panelHeightRef.current = panelHeight
  // 拖拽内部状态：同时存 rAF id 和拖拽中的实时高度
  const dragStateRef = useRef<{
    startY: number
    startHeight: number
    liveHeight: number
    rafId: number | null
  } | null>(null)
  // 整个聊天列区域的 ref，用于计算最大高度（容器的 1/3）
  const columnRef = useRef<HTMLDivElement>(null)

  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startHeight = panelHeightRef.current  // 始终是当前真实高度
    const maxH = columnRef.current
      ? Math.floor(columnRef.current.offsetHeight / 3)
      : 400
    dragStateRef.current = { startY: e.clientY, startHeight, liveHeight: startHeight, rafId: null }

    const onMouseMove = (ev: MouseEvent) => {
      const ds = dragStateRef.current
      if (!ds) return
      const delta = ds.startY - ev.clientY
      ds.liveHeight = Math.min(maxH, Math.max(MIN_INPUT_HEIGHT, ds.startHeight + delta))
      // 用 rAF 合并高频 mousemove，避免每帧多次 setState
      if (ds.rafId !== null) return
      ds.rafId = requestAnimationFrame(() => {
        if (!dragStateRef.current) return
        dragStateRef.current.rafId = null
        setPanelHeight(dragStateRef.current.liveHeight)
      })
    }
    const onMouseUp = () => {
      const ds = dragStateRef.current
      if (ds) {
        if (ds.rafId !== null) cancelAnimationFrame(ds.rafId)
        setPanelHeight(ds.liveHeight)
      }
      dragStateRef.current = null
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAgentAvatarClick = useCallback((agentId: string, agentName: string) => {
    setPersonaAgentId(agentId)
    setPersonaAgentName(agentName)
    setPersonaPanelOpen(true)
  }, [])

  const conversation = state.conversations.find(
    (c) => c.id === state.activeConversationId
  )

  const messages = state.activeConversationId
    ? (state.messages[state.activeConversationId] ?? [])
    : []

  // Scroll to bottom when messages change or streaming content grows
  const lastMsg = messages.at(-1)
  const scrollKey = `${messages.length}:${lastMsg?.id ?? ""}:${lastMsg?.id?.startsWith("streaming-") ? lastMsg.content.length : ""}:${state.thinkingAgents.size}`
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey])

  // 输入区高度变化时保持滚动到底部（viewport 变小后 scrollTop 会停在旧位置）
  const isMountedRef = useRef(false)
  useEffect(() => {
    if (!isMountedRef.current) { isMountedRef.current = true; return }
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelHeight])

  if (!conversation) {
    const isConnecting = state.connectionStatus === 'connecting'
    const notConnected = state.connectionStatus === 'disconnected' || state.connectionStatus === 'error'
    const noAgents = state.agents.length === 0

    return (
      <div
        className="flex-1 flex items-center justify-center h-full"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div
          className="text-center"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {isConnecting ? (
            <>
              <Loader2 className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3 animate-spin" />
              <p className="text-sm text-muted-foreground/60">{t("topNav.connection.connecting")}</p>
            </>
          ) : notConnected && noAgents ? (
            <>
              <WifiOff className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground">{t("chatWindow.notConnectedTitle")}</p>
              <p className="text-xs text-muted-foreground/70 mt-1 mb-4">{t("chatWindow.notConnectedDesc")}</p>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => dispatch({ type: "SET_VIEW", payload: "openclaw" })}
              >
                <Activity className="h-3.5 w-3.5" />
                {t("chatWindow.goToOpenclaw")}
              </Button>
            </>
          ) : (
            <>
              <p className="text-lg font-medium text-muted-foreground">{t("chatWindow.emptyTitle")}</p>
              <p className="text-sm mt-1 text-muted-foreground/70">{t("chatWindow.emptyDescription")}</p>
            </>
          )}
        </div>
      </div>
    )
  }

  const isGroup = conversation.type === "group"
  const thinkingAgents = conversation.members.filter((id) =>
    state.thinkingAgents.has(id)
  )

  const members = conversation.members
    .map((id) => {
      if (id === "user") return { id, name: t("common.meHuman") }
      const a = state.agents.find((ag) => ag.id === id)
      return a ? { id: a.id, name: a.name } : null
    })
    .filter((m): m is NonNullable<typeof m> => m != null)

  // Build message list with date separators
  const items: Array<{ type: "date"; label: string; key: string } | { type: "msg"; msg: Message }> = []
  let lastDateKey = ""
  for (const msg of messages) {
    const dk = getDateKey(msg.timestamp)
    if (dk && dk !== lastDateKey) {
      items.push({ type: "date", label: formatDateSeparator(msg.timestamp, t), key: `sep-${dk}` })
      lastDateKey = dk
    }
    items.push({ type: "msg", msg })
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* CSS Grid 列：header=auto, 消息区=minmax(0,1fr), 拖拽=4px, 输入=panelHeight */}
      <div
        ref={columnRef}
        className="flex-1 min-w-0 grid overflow-hidden"
        style={{ gridTemplateRows: `auto minmax(0, 1fr) 4px ${panelHeight}px` }}
      >
        <ChatHeader
          conversation={conversation}
          onToggleMembers={isGroup ? () => setShowMembers((p) => !p) : undefined}
          onAgentAvatarClick={handleAgentAvatarClick}
        />

        <ScrollArea className="overflow-hidden px-4 py-2">
          <div className="space-y-0.5">
            {items.map((item) =>
              item.type === "date" ? (
                <DateSeparator key={item.key} label={item.label} />
              ) : (
                <MessageBubble
                  key={item.msg.id}
                  message={item.msg}
                  showSenderInfo={isGroup}
                  onAgentAvatarClick={handleAgentAvatarClick}
                />
              )
            )}

            {thinkingAgents.map((agentId) => {
              const agent = state.agents.find((a) => a.id === agentId)
              if (!agent) return null
              return (
                <TypingIndicator
                  key={agentId}
                  agentId={agentId}
                  agentName={agent.name}
                  agentAvatar={agent.avatar}
                />
              )
            })}
          </div>
          <div ref={messagesEndRef} />
        </ScrollArea>

        {/* 拖拽手柄 — 不可见，悬停时只改变光标 */}
        <div
          className="cursor-ns-resize select-none"
          onMouseDown={handleDragMouseDown}
        />

        <MessageInput
          onSend={(content, attachments) => {
            if (state.activeConversationId) {
              sendMessage(state.activeConversationId, content, attachments)
            }
          }}
          onNewSession={() => {
            if (state.activeConversationId) {
              resetSession(state.activeConversationId)
            }
          }}
          onAbort={() => {
            if (state.activeConversationId) {
              abortConversation(state.activeConversationId)
            }
          }}
          isGenerating={thinkingAgents.length > 0}
          showMention={isGroup}
          members={members}
          panelHeight={panelHeight}
          onAttachmentCountChange={(count) => {
            if (count > 0) {
              setPanelHeight((prev) => Math.max(prev, MIN_INPUT_HEIGHT_WITH_ATTACHMENT))
            }
          }}
        />
      </div>

      {isGroup && (
        <GroupMembersPanel
          conversation={conversation}
          open={showMembers}
          onOpenChange={setShowMembers}
        />
      )}

      <PersonaPanel
        open={personaPanelOpen}
        onOpenChange={setPersonaPanelOpen}
        agentId={personaAgentId}
        agentName={personaAgentName}
      />
    </div>
  )
}
