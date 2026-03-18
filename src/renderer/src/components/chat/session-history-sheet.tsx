import { useEffect } from "react"
import { ArrowLeft, Clock, Loader2, MessageSquare, RotateCcw, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { useSessionHistory } from "@/hooks/use-session-history"
import type { SessionRow, HistoryMsg } from "@/hooks/use-session-history"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface SessionHistorySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  currentSessionKey?: string
}

export function SessionHistorySheet({ open, onOpenChange, agentId, currentSessionKey }: SessionHistorySheetProps) {
  const { t } = useI18n()
  const {
    sessions,
    selectedSessionId,
    messages,
    loadingSessions,
    loadingHistory,
    loadSessions,
    selectSession,
    clearSelection,
  } = useSessionHistory(agentId)

  useEffect(() => {
    if (open && agentId) {
      loadSessions()
      clearSelection()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentId])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:w-[480px] p-0 flex flex-col gap-0">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            {selectedSessionId && (
              <button
                type="button"
                className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  clearSelection()
                }}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <SheetTitle className="text-base">
              {selectedSessionId
                ? t("sessionHistory.historyMessages")
                : t("sessionHistory.title")}
            </SheetTitle>
          </div>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {selectedSessionId ? (
            <HistoryMessageList
              messages={messages}
              loading={loadingHistory}
            />
          ) : (
            <SessionList
              sessions={sessions}
              loading={loadingSessions}
              currentSessionKey={currentSessionKey}
              agentId={agentId}
              onSelect={selectSession}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/* ── Session List ──────────────────────────────────────────────────────────── */

interface SessionListProps {
  sessions: SessionRow[]
  loading: boolean
  currentSessionKey?: string
  agentId: string
  onSelect: (sessionId: string, sessionKey?: string | null) => void
}

function SessionList({ sessions, loading, currentSessionKey, agentId, onSelect }: SessionListProps) {
  const { t } = useI18n()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">{t("sessionHistory.loadingHistory")}</span>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <MessageSquare className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">{t("sessionHistory.noSessions")}</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-1">
        {sessions.map((s) => {
          const isCurrent = currentSessionKey
            ? s.sessionKey === currentSessionKey
            : s.sessionKey === `agent:${agentId}:main`
          return (
            <button
              key={s.sessionId}
              type="button"
              className={cn(
                "w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border/40 last:border-b-0",
                isCurrent && "bg-blue-50/50 dark:bg-blue-950/20"
              )}
              onClick={() => onSelect(s.sessionId, s.sessionKey)}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium truncate flex-1">
                  {s.displayName || sessionDisplayName(s, agentId)}
                </span>
                {isCurrent && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400 shrink-0">
                    {t("sessionHistory.current")}
                  </Badge>
                )}
                {s.isReset && (
                  <RotateCcw className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {s.updatedAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(s.updatedAt)}
                  </span>
                )}
                {s.contextTokens != null && s.contextTokens > 0 && (
                  <span className="flex items-center gap-1">
                    <Zap className="h-3 w-3" />
                    {formatTokens(s.contextTokens)} tokens
                  </span>
                )}
                {!s.isTracked && (
                  <span className="text-muted-foreground/40">{t("sessionHistory.archived")}</span>
                )}
              </div>
              {s.lastMessagePreview && (
                <p className="text-xs text-muted-foreground/70 mt-1 truncate">
                  {s.lastMessagePreview}
                </p>
              )}
            </button>
          )
        })}
      </div>
    </ScrollArea>
  )
}

/* ── History Message List ──────────────────────────────────────────────────── */

function HistoryMessageList({ messages, loading }: { messages: HistoryMsg[]; loading: boolean }) {
  const { t } = useI18n()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">{t("sessionHistory.loadingHistory")}</span>
      </div>
    )
  }

  const visible = messages.filter((m) => m.role === "user" || m.role === "assistant")
  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <MessageSquare className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">{t("sessionHistory.empty")}</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-2 px-3 space-y-2">
        {visible.map((msg, i) => (
          <HistoryBubble key={i} msg={msg} />
        ))}
      </div>
    </ScrollArea>
  )
}

/* ── Single History Bubble ─────────────────────────────────────────────────── */

function HistoryBubble({ msg }: { msg: HistoryMsg }) {
  const text = extractText(msg.content)
  const isUser = msg.role === "user"
  const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : ""

  return (
    <div className={cn("flex gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <div className={cn(
        "max-w-[85%] rounded-lg px-3 py-2 text-sm",
        isUser
          ? "rounded-tr-sm bg-[#d6e4ff] text-foreground"
          : "rounded-tl-sm bg-muted"
      )}>
        {isUser ? (
          <span className="whitespace-pre-wrap">{text}</span>
        ) : (
          <HistoryMarkdown content={text} />
        )}
      </div>
      {time && (
        <span className="text-[10px] text-muted-foreground/40 self-end shrink-0">{time}</span>
      )}
    </div>
  )
}

/* ── Markdown renderer for history ─────────────────────────────────────────── */

function HistoryMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
        pre: ({ children }) => (
          <pre className="bg-black/5 dark:bg-white/10 rounded p-2 overflow-x-auto my-1.5 text-xs font-mono">
            {children}
          </pre>
        ),
        code: ({ className, children }) =>
          className
            ? <code className={className}>{children}</code>
            : <code className="bg-black/10 dark:bg-white/15 px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
        a: ({ href, children }) => (
          <a href={href} className="text-blue-500 hover:underline" target="_blank" rel="noreferrer">{children}</a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function extractText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content.map((p) => {
      if (typeof p === "string") return p
      if (p && typeof p === "object") {
        const r = p as Record<string, unknown>
        if (r.type === "text" && typeof r.text === "string") return r.text
      }
      return ""
    }).filter(Boolean).join("\n")
  }
  return ""
}

function sessionDisplayName(
  s: { sessionKey: string | null; displayName?: string; kind?: string; sessionId: string; isReset?: boolean },
  agentId: string,
): string {
  if (s.displayName) return s.displayName
  if (!s.sessionKey) {
    // Orphaned session — show truncated sessionId
    return s.isReset ? `Reset session` : `Session ${s.sessionId.slice(0, 8)}`
  }
  // Strip "agent:<id>:" prefix for a cleaner display
  const stripped = s.sessionKey.replace(`agent:${agentId}:`, "")
  if (stripped === "main") return "Main"
  return stripped
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 0) return "刚刚"
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return "刚刚"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  const months = Math.floor(days / 30)
  return `${months}个月前`
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
