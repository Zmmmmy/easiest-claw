import { useEffect, useState } from "react"
import {
  AlertCircle,
  Bot,
  Brain,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  Info,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useApp } from "@/store/app-context"
import { getAgentAvatarUrl, useAvatarVersion } from "@/lib/avatar"
import { parseSkillsResult } from "@/components/skills/skills-view"
import type { Agent } from "@/types"
import type { CronJob, CronSchedule } from "@/types/cron"

// ── Shared types ──────────────────────────────────────────────────────────────

interface Skill {
  name: string
  description?: string
  version?: string
  enabled: boolean
}

interface AgentSession {
  sessionKey: string      // mapped from `key` in gateway response
  sessionId?: string
  updatedAt?: number      // ms timestamp
  label?: string
  displayName?: string
  channel?: string
  subject?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  contextTokens?: number
  kind?: string
  lastMessagePreview?: string
}

type TabId = "overview" | "sessions" | "memory" | "skills" | "cron"

// ── Helpers ───────────────────────────────────────────────────────────────────

const statusLabel: Record<string, string> = {
  idle: "空闲",
  working: "工作中",
  thinking: "思考中",
  chatting: "对话中",
  busy: "忙碌",
  completed: "已完成",
}

const statusDotClass: Record<string, string> = {
  idle: "bg-muted-foreground/40",
  working: "bg-blue-500 animate-pulse",
  thinking: "bg-blue-500 animate-pulse",
  chatting: "bg-green-500",
  busy: "bg-amber-500",
  completed: "bg-muted-foreground/40",
}

function formatRelativeTime(ts: string | number | undefined): string {
  if (!ts) return "—"
  const ms = typeof ts === "number" ? ts : Date.parse(ts)
  if (isNaN(ms)) return "—"
  const diff = Date.now() - ms
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

function formatSchedule(schedule: CronSchedule): string {
  if (schedule.kind === "at") return `一次性: ${schedule.at}`
  if (schedule.kind === "every") {
    const ms = schedule.everyMs
    if (ms < 60_000) return `每 ${ms / 1000} 秒`
    if (ms < 3_600_000) return `每 ${ms / 60_000} 分钟`
    if (ms < 86_400_000) return `每 ${ms / 3_600_000} 小时`
    return `每 ${ms / 86_400_000} 天`
  }
  return schedule.expr
}

function formatNextRun(ms: number | null | undefined): string {
  if (!ms) return "—"
  const diff = ms - Date.now()
  if (diff <= 0) return "待触发"
  if (diff < 60_000) return `${Math.ceil(diff / 1000)}s 后`
  if (diff < 3_600_000) return `${Math.ceil(diff / 60_000)}m 后`
  return new Date(ms).toLocaleString()
}

function parseSessions(raw: unknown): AgentSession[] {
  const list = Array.isArray((raw as Record<string, unknown>)?.sessions)
    ? ((raw as { sessions: unknown[] }).sessions)
    : Array.isArray(raw) ? raw : []
  return (list as Record<string, unknown>[]).map((s) => ({
    sessionKey: typeof s.key === "string" ? s.key : "",   // gateway field is "key", not "sessionKey"
    sessionId: typeof s.sessionId === "string" ? s.sessionId : undefined,
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : undefined,
    label: typeof s.label === "string" ? s.label : undefined,
    displayName: typeof s.displayName === "string" ? s.displayName : undefined,
    channel: typeof s.channel === "string" ? s.channel : undefined,
    subject: typeof s.subject === "string" ? s.subject : undefined,
    model: typeof s.model === "string" ? s.model : undefined,
    inputTokens: typeof s.inputTokens === "number" ? s.inputTokens : undefined,
    outputTokens: typeof s.outputTokens === "number" ? s.outputTokens : undefined,
    contextTokens: typeof s.contextTokens === "number" ? s.contextTokens : undefined,
    kind: typeof s.kind === "string" ? s.kind : undefined,
    lastMessagePreview: typeof s.lastMessagePreview === "string" ? s.lastMessagePreview : undefined,
  })).filter((s) => s.sessionKey)
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ agent, cronCount, sessionCount }: { agent: Agent; cronCount: number; sessionCount: number }) {
  return (
    <div className="h-full overflow-y-auto px-6 py-5 space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center">
          <p className="text-2xl font-semibold tabular-nums">{sessionCount}</p>
          <p className="text-xs text-muted-foreground mt-0.5">活跃会话</p>
        </div>
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center">
          <p className="text-2xl font-semibold tabular-nums">{cronCount}</p>
          <p className="text-xs text-muted-foreground mt-0.5">定时任务</p>
        </div>
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center">
          <p className="text-sm font-medium truncate">
            <span className={cn("inline-block h-2 w-2 rounded-full mr-1.5", statusDotClass[agent.status] ?? "bg-muted-foreground/40")} />
            {statusLabel[agent.status] ?? agent.status}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">当前状态</p>
        </div>
      </div>

      <Separator />

      {/* Info rows */}
      <div className="space-y-3 text-sm">
        <div className="flex items-start gap-3">
          <span className="w-20 shrink-0 text-muted-foreground text-xs pt-0.5">Agent ID</span>
          <div className="flex items-center gap-1.5 min-w-0">
            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded truncate max-w-[260px]">
              {agent.id}
            </code>
            <button
              onClick={() => { navigator.clipboard.writeText(agent.id); toast.success("已复制") }}
              className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-muted-foreground text-xs">分类</span>
          <span>{agent.category || "—"}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-muted-foreground text-xs">角色</span>
          <span>{agent.role || "—"}</span>
        </div>

        {agent.lastActiveAt && (
          <div className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-muted-foreground text-xs">最近活跃</span>
            <span className="text-muted-foreground">{formatRelativeTime(agent.lastActiveAt)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sessions Tab ──────────────────────────────────────────────────────────────

interface HistoryMsg {
  role: string
  content: unknown
  timestamp?: number
}

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

function parseHistoryMessages(raw: unknown): HistoryMsg[] {
  const list = Array.isArray((raw as Record<string, unknown>)?.messages)
    ? ((raw as { messages: unknown[] }).messages)
    : Array.isArray(raw) ? raw : []
  return (list as Record<string, unknown>[])
    .filter((m) => !(m.__openclaw && (m.__openclaw as Record<string, unknown>).kind === "compaction"))
    .map((m) => ({
      role: typeof m.role === "string" ? m.role : "unknown",
      content: m.content,
      timestamp: typeof m.timestamp === "number" ? m.timestamp : undefined,
    }))
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// Short session display name: strip "agent:<id>:" prefix, fallback to displayName/label
function sessionDisplayName(s: AgentSession, agentId: string): string {
  if (s.displayName) return s.displayName
  if (s.label) return s.label
  if (s.subject) return s.subject
  const stripped = s.sessionKey.replace(`agent:${agentId}:`, "")
  return stripped || s.sessionKey
}

function SessionsTab({ agent, refreshTick }: { agent: Agent; refreshTick: number }) {
  const mainKey = `agent:${agent.id}:main`
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [selectedKey, setSelectedKey] = useState<string>(mainKey)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [messages, setMessages] = useState<HistoryMsg[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [resetting, setResetting] = useState(false)

  const loadSessions = () => {
    setSessionsLoading(true)
    window.ipc.sessionsList({ agentId: agent.id, includeLastMessage: true })
      .then((res) => {
        const list = res.ok ? parseSessions(res.result) : []
        // Always ensure main session is present
        const hasMain = list.some((s) => s.sessionKey === mainKey)
        setSessions(hasMain ? list : [{ sessionKey: mainKey, kind: "direct" }, ...list])
      })
      .finally(() => setSessionsLoading(false))
  }

  const loadHistory = (sessionKey: string) => {
    setHistoryLoading(true)
    setMessages([])
    window.ipc.chatHistory({ agentId: agent.id, sessionKey })
      .then((res) => { if (res.ok) setMessages(parseHistoryMessages(res.result)) })
      .finally(() => setHistoryLoading(false))
  }

  useEffect(() => {
    setSelectedKey(mainKey)
    loadSessions()
  }, [agent.id, refreshTick])

  useEffect(() => {
    loadHistory(selectedKey)
  }, [selectedKey, agent.id, refreshTick])

  const handleReset = async () => {
    setResetting(true)
    try {
      const res = await window.ipc.sessionsReset({ sessionKey: selectedKey })
      if ((res as { ok: boolean }).ok) {
        toast.success("会话已重置")
        loadHistory(selectedKey)
        loadSessions()
      } else {
        toast.error((res as { ok: false; error: string }).error ?? "重置失败")
      }
    } finally {
      setResetting(false)
    }
  }

  const selectedSession = sessions.find((s) => s.sessionKey === selectedKey)

  const roleStyle: Record<string, { label: string; className: string }> = {
    user:      { label: "用户",  className: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" },
    assistant: { label: "Agent", className: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300" },
    system:    { label: "系统",  className: "bg-muted text-muted-foreground" },
    tool:      { label: "工具",  className: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300" },
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Session list sidebar */}
      <div className="w-44 shrink-0 border-r flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
            {sessionsLoading ? "加载中…" : `${sessions.length} 个会话`}
          </p>
          {sessionsLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />}
        </div>
        <div className="flex-1 overflow-y-auto py-1 px-1.5 space-y-0.5">
          {sessions.map((s) => {
            const name = sessionDisplayName(s, agent.id)
            const isSelected = selectedKey === s.sessionKey
            return (
              <button
                key={s.sessionKey}
                onClick={() => setSelectedKey(s.sessionKey)}
                className={cn(
                  "w-full text-left px-2 py-2 rounded-md transition-colors",
                  isSelected ? "bg-accent" : "hover:bg-accent/50"
                )}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {s.channel && (
                    <span className="text-[9px] bg-muted text-muted-foreground px-1 py-0 rounded shrink-0 uppercase font-medium">
                      {s.channel}
                    </span>
                  )}
                  <span className={cn("text-xs truncate", isSelected ? "text-foreground font-medium" : "text-muted-foreground")}>
                    {name}
                  </span>
                </div>
                {s.lastMessagePreview && (
                  <p className="text-[10px] text-muted-foreground/60 truncate mt-0.5 leading-snug">
                    {s.lastMessagePreview}
                  </p>
                )}
                {s.updatedAt && (
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                    {formatRelativeTime(s.updatedAt)}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Message history */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b">
          <div className="flex-1 min-w-0 space-y-0.5">
            <code className="text-[10px] text-muted-foreground font-mono block truncate">
              {selectedKey}
            </code>
            {selectedSession && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
                {selectedSession.model && <span>{selectedSession.model}</span>}
                {selectedSession.inputTokens !== undefined && (
                  <span>↑{formatTokens(selectedSession.inputTokens)} ↓{formatTokens(selectedSession.outputTokens ?? 0)}</span>
                )}
                {selectedSession.contextTokens !== undefined && (
                  <span>ctx {formatTokens(selectedSession.contextTokens)}</span>
                )}
              </div>
            )}
          </div>
          <Button
            size="sm" variant="ghost"
            className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive shrink-0"
            disabled={resetting}
            onClick={handleReset}
          >
            {resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            重置
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {historyLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />加载中...
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Clock className="h-8 w-8 opacity-30" />
              <p>暂无消息记录</p>
            </div>
          ) : (
            messages.map((msg, i) => {
              const style = roleStyle[msg.role] ?? { label: msg.role, className: "bg-muted text-muted-foreground" }
              const text = extractText(msg.content)
              if (!text) return null
              return (
                <div key={i} className="flex items-start gap-2">
                  <span className={cn("shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium mt-0.5 w-10 text-center", style.className)}>
                    {style.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground whitespace-pre-wrap break-words line-clamp-6">{text}</p>
                    {msg.timestamp && (
                      <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                        {new Date(msg.timestamp).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// ── Skills Tab ────────────────────────────────────────────────────────────────

function SkillsTab({
  agent,
  globalSkills,
  globalLoading,
  refreshTick,
}: {
  agent: Agent
  globalSkills: Skill[]
  globalLoading: boolean
  refreshTick: number
}) {
  const [allowlist, setAllowlist] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    window.ipc.agentSkillsGet(agent.id)
      .then((res) => { if (res.ok) setAllowlist(res.skills) })
      .finally(() => setLoading(false))
  }, [agent.id, refreshTick])

  const hasCustomList = allowlist !== null
  const isAllowed = (name: string) => allowlist === null ? true : allowlist.includes(name)

  const saveAllowlist = async (skills: string[] | null) => {
    setSaving(true)
    try {
      const res = await window.ipc.agentSkillsSet(agent.id, skills)
      if (res.ok) {
        setAllowlist(skills)
      } else {
        toast.error((res as { ok: false; error: string }).error ?? "保存失败")
      }
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (skillName: string, checked: boolean) => {
    const base = allowlist ?? globalSkills.map((s) => s.name)
    const next = checked ? [...base, skillName] : base.filter((s) => s !== skillName)
    const allEnabled = globalSkills.every((s) => next.includes(s.name))
    await saveAllowlist(allEnabled ? null : next)
  }

  const isLoading = loading || globalLoading

  return (
    <div className="h-full overflow-y-auto px-6 py-4 space-y-4">
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />加载中...
        </div>
      ) : globalSkills.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">暂无可用技能</div>
      ) : (
        <>
          <div className={cn(
            "flex items-start gap-2 rounded-md px-3 py-2 text-xs",
            hasCustomList
              ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
              : "bg-muted/60 text-muted-foreground"
          )}>
            {hasCustomList
              ? <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              : <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            }
            <span>
              {hasCustomList
                ? "该智能体使用自定义技能允许列表。"
                : "所有技能已启用。禁用任何技能将创建该智能体的专属允许列表。"}
            </span>
            {hasCustomList && (
              <Badge variant="outline" className="ml-auto shrink-0 text-[10px] px-1.5 py-0 text-amber-600 border-amber-300">
                自定义
              </Badge>
            )}
          </div>

          <div className="space-y-0.5">
            {globalSkills.map((skill) => (
              <label
                key={skill.name}
                className={cn(
                  "flex items-center gap-3 px-2 py-2 rounded-md cursor-pointer transition-colors hover:bg-accent/50",
                  saving && "opacity-50 pointer-events-none"
                )}
              >
                <input
                  type="checkbox"
                  checked={isAllowed(skill.name)}
                  onChange={(e) => handleToggle(skill.name, e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0 accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{skill.name}</span>
                    {skill.version && (
                      <span className="text-[10px] text-muted-foreground">v{skill.version}</span>
                    )}
                    {!skill.enabled && (
                      <span className="text-[10px] text-orange-500">全局已禁用</span>
                    )}
                  </div>
                  {skill.description && (
                    <p className="text-[11px] text-muted-foreground truncate">{skill.description}</p>
                  )}
                </div>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t">
            {hasCustomList && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={saving} onClick={() => saveAllowlist(null)}>
                <RotateCcw className="h-3 w-3" />恢复全部
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={saving} onClick={() => saveAllowlist([])}>
              <XCircle className="h-3 w-3" />全部禁用
            </Button>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>

          {hasCustomList && (
            <p className="text-[10px] text-muted-foreground">配置已写入本地文件，重启 Gateway 后生效。</p>
          )}
        </>
      )}
    </div>
  )
}

// ── Cron Tab ──────────────────────────────────────────────────────────────────

const lastRunBadge: Record<string, { label: string; className: string }> = {
  ok:      { label: "成功", className: "text-green-600 bg-green-50 dark:bg-green-950/30 border-green-200" },
  error:   { label: "出错", className: "text-red-600 bg-red-50 dark:bg-red-950/30 border-red-200" },
  skipped: { label: "跳过", className: "text-amber-600 bg-amber-50 dark:bg-amber-950/30 border-amber-200" },
}

function CronTab({ agent, refreshTick }: { agent: Agent; refreshTick: number }) {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    window.ipc.cronList()
      .then((res) => {
        if (res.ok) {
          const all = (res.result as { jobs?: CronJob[] })?.jobs ?? []
          setJobs(all.filter((j) => j.agentId === agent.id))
        }
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [agent.id, refreshTick])

  const handleToggle = async (job: CronJob) => {
    setActionId(job.id)
    try {
      await window.ipc.cronUpdate({ jobId: job.id, enabled: !job.enabled })
      load()
    } finally {
      setActionId(null)
    }
  }

  const handleRunNow = async (job: CronJob) => {
    setActionId(job.id)
    try {
      await window.ipc.cronRun({ jobId: job.id })
      toast.success(`「${job.name}」已触发`)
    } finally {
      setActionId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />加载中...
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Zap className="h-8 w-8 opacity-30" />
        <p>该 Agent 暂无定时任务</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-4 space-y-2">
      {jobs.map((job) => {
        const lastStatus = job.state.lastRunStatus
        const badge = lastStatus ? lastRunBadge[lastStatus] : null
        const isActing = actionId === job.id

        return (
          <div key={job.id} className="rounded-lg border px-4 py-3 bg-background space-y-2">
            {/* Row 1: name + badges + actions */}
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full shrink-0", job.enabled ? "bg-green-500" : "bg-muted-foreground/40")} />
              <span className="text-sm font-medium flex-1 truncate">{job.name}</span>
              {badge && (
                <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 shrink-0", badge.className)}>
                  {badge.label}
                </Badge>
              )}
              <Button
                size="sm" variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-primary shrink-0"
                disabled={isActing}
                onClick={() => handleRunNow(job)}
                title="立即执行"
              >
                {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              </Button>
              {/* Toggle */}
              <button
                onClick={() => handleToggle(job)}
                disabled={isActing}
                className={cn(
                  "shrink-0 w-9 h-5 rounded-full transition-colors relative",
                  job.enabled ? "bg-primary" : "bg-muted-foreground/30",
                  isActing && "opacity-50 cursor-not-allowed"
                )}
                title={job.enabled ? "点击禁用" : "点击启用"}
              >
                <span className={cn(
                  "absolute top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200",
                  job.enabled ? "left-[18px]" : "left-[2px]"
                )} />
              </button>
            </div>

            {/* Row 2: schedule info */}
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatSchedule(job.schedule)}
              </span>
              {job.state.nextRunAtMs && (
                <span>下次: {formatNextRun(job.state.nextRunAtMs)}</span>
              )}
              {job.state.lastRunAtMs && (
                <span>上次: {formatRelativeTime(job.state.lastRunAtMs)}</span>
              )}
              {job.state.lastDurationMs && (
                <span>{(job.state.lastDurationMs / 1000).toFixed(1)}s</span>
              )}
            </div>

            {job.description && (
              <p className="text-[11px] text-muted-foreground/70">{job.description}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Memory Tab ───────────────────────────────────────────────────────────────

interface DailyMemoryFile {
  name: string
  size: number
  updatedAtMs: number
}

function MemoryTab({ agent, refreshTick }: { agent: Agent; refreshTick: number }) {
  const [memoryContent, setMemoryContent] = useState("")
  const [editContent, setEditContent] = useState("")
  const [hasUnsaved, setHasUnsaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dailyFiles, setDailyFiles] = useState<DailyMemoryFile[]>([])
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState("")
  const [expandedLoading, setExpandedLoading] = useState(false)
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setHasUnsaved(false)
    setExpandedFile(null)

    Promise.all([
      window.ipc.agentsFilesGet({ agentId: agent.id, name: "MEMORY.md" }),
      window.ipc.agentsMemoryList({ agentId: agent.id }),
      window.ipc.sessionsList({ agentId: agent.id, includeLastMessage: false }),
    ]).then(([memRes, dailyRes, sessRes]) => {
      const content = memRes.ok ? ((memRes.result as { content?: string })?.content ?? "") : ""
      setMemoryContent(content)
      setEditContent(content)

      if (dailyRes.ok) {
        setDailyFiles((dailyRes as { ok: true; files: DailyMemoryFile[] }).files ?? [])
      }

      if (sessRes.ok) {
        setSessions(parseSessions(sessRes.result))
      }
    }).finally(() => setLoading(false))
  }, [agent.id, refreshTick])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await window.ipc.agentsFilesSet({ agentId: agent.id, name: "MEMORY.md", content: editContent })
      if ((res as { ok: boolean }).ok) {
        setMemoryContent(editContent)
        setHasUnsaved(false)
        toast.success("记忆已保存")
      } else {
        toast.error((res as { ok: false; error: string }).error ?? "保存失败")
      }
    } finally {
      setSaving(false)
    }
  }

  const handleExpand = async (fileName: string) => {
    if (expandedFile === fileName) {
      setExpandedFile(null)
      return
    }
    setExpandedFile(fileName)
    setExpandedLoading(true)
    setExpandedContent("")
    try {
      const res = await window.ipc.agentsMemoryGet({ agentId: agent.id, name: fileName })
      if (res.ok) {
        setExpandedContent((res as { ok: true; content: string }).content ?? "")
      }
    } finally {
      setExpandedLoading(false)
    }
  }

  // Token stats from sessions
  const totalInput = sessions.reduce((sum, s) => sum + (s.inputTokens ?? 0), 0)
  const totalOutput = sessions.reduce((sum, s) => sum + (s.outputTokens ?? 0), 0)
  const totalContext = sessions.reduce((sum, s) => sum + (s.contextTokens ?? 0), 0)
  const lastActive = sessions.reduce((max, s) => Math.max(max, s.updatedAt ?? 0), 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />加载中...
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-5 space-y-5">
      {/* 会话统计 */}
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <Zap className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">会话统计</h3>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold tabular-nums">{sessions.length}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">会话数</p>
          </div>
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold tabular-nums">{formatTokens(totalInput)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">输入 Token</p>
          </div>
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold tabular-nums">{formatTokens(totalOutput)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">输出 Token</p>
          </div>
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold tabular-nums">{formatTokens(totalContext)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">上下文 Token</p>
          </div>
        </div>
        {lastActive > 0 && (
          <p className="text-[10px] text-muted-foreground/60 mt-1.5">
            最近活跃: {formatRelativeTime(lastActive)}
          </p>
        )}
      </div>

      <Separator />

      {/* MEMORY.md 长期记忆 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">长期记忆 (MEMORY.md)</h3>
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hasUnsaved || saving}
            className="h-7 text-xs gap-1"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            保存
          </Button>
        </div>
        <Textarea
          value={editContent}
          onChange={(e) => {
            setEditContent(e.target.value)
            setHasUnsaved(e.target.value !== memoryContent)
          }}
          className="min-h-[200px] font-mono text-xs leading-relaxed resize-y"
          placeholder="暂无长期记忆，智能体会在对话中自动积累记忆..."
        />
        {hasUnsaved && (
          <p className="text-[10px] text-amber-600 mt-1">有未保存的修改</p>
        )}
      </div>

      <Separator />

      {/* 每日记忆日志 */}
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            每日记忆 ({dailyFiles.length})
          </h3>
        </div>
        {dailyFiles.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">暂无每日记忆日志</p>
        ) : (
          <div className="space-y-1">
            {dailyFiles.map((file) => {
              const isExpanded = expandedFile === file.name
              return (
                <div key={file.name} className="rounded-md border overflow-hidden">
                  <button
                    onClick={() => handleExpand(file.name)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors"
                  >
                    {isExpanded
                      ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                      : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                    <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-xs font-mono flex-1">{file.name}</span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="border-t px-3 py-2 bg-muted/20">
                      {expandedLoading ? (
                        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground justify-center">
                          <Loader2 className="h-3 w-3 animate-spin" />加载中...
                        </div>
                      ) : (
                        <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto">
                          {expandedContent || "(空文件)"}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main View ─────────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: "overview",  label: "概览" },
  { id: "sessions",  label: "会话" },
  { id: "memory",    label: "记忆" },
  { id: "skills",    label: "技能" },
  { id: "cron",      label: "定时任务" },
]

export function AgentConfigView() {
  const { state } = useApp()
  useAvatarVersion()
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>("overview")
  const [globalSkills, setGlobalSkills] = useState<Skill[]>([])
  const [globalLoading, setGlobalLoading] = useState(true)
  const [refreshTick, setRefreshTick] = useState(0)
  // For overview stats
  const [sessionCount, setSessionCount] = useState(0)
  const [cronCount, setCronCount] = useState(0)

  useEffect(() => {
    if (state.agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(state.agents[0].id)
    }
  }, [state.agents, selectedAgentId])

  const loadGlobalSkills = () => {
    setGlobalLoading(true)
    window.ipc.skillsList()
      .then((res) => { if (res.ok) setGlobalSkills(parseSkillsResult(res.result)) })
      .finally(() => setGlobalLoading(false))
  }

  useEffect(() => { loadGlobalSkills() }, [])

  // Load overview stats when agent changes
  useEffect(() => {
    if (!selectedAgentId) return
    window.ipc.sessionsList({ agentId: selectedAgentId })
      .then((res) => {
        if (res.ok) setSessionCount(parseSessions(res.result).length)
      })
    window.ipc.cronList()
      .then((res) => {
        if (res.ok) {
          const all = (res.result as { jobs?: CronJob[] })?.jobs ?? []
          setCronCount(all.filter((j) => j.agentId === selectedAgentId).length)
        }
      })
  }, [selectedAgentId, refreshTick])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") handleRefresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [])

  const handleRefresh = () => {
    loadGlobalSkills()
    setRefreshTick((t) => t + 1)
  }

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId)
    setActiveTab("overview")
  }

  const selectedAgent = state.agents.find((a) => a.id === selectedAgentId) ?? null

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-muted/20">
      {/* Page Header */}
      <div
        className="shrink-0 flex items-center px-8 py-5 border-b bg-background"
        style={{
          WebkitAppRegion: "drag",
          ...(window.ipc.platform !== "darwin" ? { paddingRight: "154px" } : {}),
        } as React.CSSProperties}
      >
        <div
          className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 shrink-0"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div className="ml-3" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <div className="flex items-center gap-1">
            <h1 className="text-lg font-semibold">Agent 配置</h1>
            <Button
              variant="ghost" size="icon"
              onClick={handleRefresh}
              disabled={globalLoading}
              className="h-6 w-6 text-muted-foreground/50 hover:text-foreground"
              title="刷新"
            >
              <RefreshCw className={cn("h-3 w-3", globalLoading && "animate-spin")} />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Agent 技能权限管理</p>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: Agent list */}
        <div className="w-[200px] shrink-0 flex flex-col border-r bg-background/50 overflow-hidden">
          <div className="flex-1 overflow-y-auto py-1 px-2">
            {state.agents.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">暂无 Agent</p>
            ) : (
              state.agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => handleSelectAgent(agent.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors",
                    "hover:bg-accent/50",
                    selectedAgentId === agent.id && "bg-accent"
                  )}
                >
                  <div className="relative shrink-0">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={getAgentAvatarUrl(agent.id)} alt={agent.name} />
                      <AvatarFallback className="text-xs font-medium bg-blue-100 text-blue-700">
                        {agent.avatar}
                      </AvatarFallback>
                    </Avatar>
                    <span className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background",
                      statusDotClass[agent.status] ?? "bg-muted-foreground/40"
                    )} />
                  </div>
                  <span className="text-sm truncate">{agent.name}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: Detail */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          {selectedAgent ? (
            <>
              {/* Agent header */}
              <div className="shrink-0 px-6 py-4 border-b flex items-center gap-3">
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarImage src={getAgentAvatarUrl(selectedAgent.id)} alt={selectedAgent.name} />
                  <AvatarFallback className="text-sm font-medium bg-blue-100 text-blue-700">
                    {selectedAgent.avatar}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{selectedAgent.name}</p>
                  <p className="text-xs text-muted-foreground">{selectedAgent.role || selectedAgent.category}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={cn("h-2 w-2 rounded-full", statusDotClass[selectedAgent.status] ?? "bg-muted-foreground/40")} />
                  <span className="text-xs text-muted-foreground">{statusLabel[selectedAgent.status] ?? selectedAgent.status}</span>
                </div>
              </div>

              {/* Tabs */}
              <div className="shrink-0 flex border-b px-6">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "px-3 py-2.5 text-sm transition-colors border-b-2 -mb-px",
                      activeTab === tab.id
                        ? "border-primary text-foreground font-medium"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-hidden">
                {activeTab === "overview" && (
                  <OverviewTab agent={selectedAgent} cronCount={cronCount} sessionCount={sessionCount} />
                )}
                {activeTab === "sessions" && (
                  <SessionsTab agent={selectedAgent} refreshTick={refreshTick} />
                )}
                {activeTab === "memory" && (
                  <MemoryTab agent={selectedAgent} refreshTick={refreshTick} />
                )}
                {activeTab === "skills" && (
                  <SkillsTab
                    agent={selectedAgent}
                    globalSkills={globalSkills}
                    globalLoading={globalLoading}
                    refreshTick={refreshTick}
                  />
                )}
                {activeTab === "cron" && (
                  <CronTab agent={selectedAgent} refreshTick={refreshTick} />
                )}
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <p className="text-sm">请选择一个 Agent</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
