
import { useEffect, useState } from "react"
import { Brain, Clock, FolderOpen, Loader2, Server, Wrench } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { getAgentAvatarUrl } from "@/lib/avatar"
import type { Agent } from "@/types"
import type { CronJob } from "@/types/cron"

type FileEntry = {
  name: string
  missing: boolean
  size?: number
  updatedAtMs?: number
}

type ToolEntry = {
  name: string
  description?: string
  source?: "core" | "plugin" | string
  pluginId?: string
  optional?: boolean
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatSchedule(job: CronJob): string {
  const s = job.schedule
  if (s.kind === "every") {
    const ms = s.everyMs
    if (ms < 60_000) return `每 ${ms / 1000}秒`
    if (ms < 3_600_000) return `每 ${ms / 60_000}分钟`
    if (ms < 86_400_000) return `每 ${ms / 3_600_000}小时`
    return `每 ${ms / 86_400_000}天`
  }
  if (s.kind === "cron") return s.expr
  if (s.kind === "at") return `一次性: ${s.at}`
  return ""
}

interface AgentInfoSheetProps {
  agent: Agent | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AgentInfoSheet({ agent, open, onOpenChange }: AgentInfoSheetProps) {
  const [workspace, setWorkspace] = useState("")
  const [files, setFiles] = useState<FileEntry[]>([])
  const [cronJobs, setCronJobs] = useState<CronJob[]>([])
  const [defaultModel, setDefaultModel] = useState("")
  const [tools, setTools] = useState<ToolEntry[]>([])
  const [memorySummary, setMemorySummary] = useState("")
  const [dailyMemoryCount, setDailyMemoryCount] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !agent) return

    setLoading(true)
    setWorkspace("")
    setFiles([])
    setCronJobs([])
    setDefaultModel("")
    setTools([])
    setMemorySummary("")
    setDailyMemoryCount(0)

    Promise.all([
      window.ipc.agentsFilesList({ agentId: agent.id }),
      window.ipc.cronList(),
      window.ipc.configGet(),
      window.ipc.toolsCatalog({ agentId: agent.id }),
      window.ipc.agentsFilesGet({ agentId: agent.id, name: "MEMORY.md" }),
      window.ipc.agentsMemoryList({ agentId: agent.id }),
    ]).then(([filesRes, cronRes, configRes, toolsRes, memoryRes, dailyRes]) => {
      if (filesRes.ok) {
        const r = filesRes.result as { workspace?: string; files?: FileEntry[] }
        setWorkspace(r.workspace ?? "")
        setFiles(r.files ?? [])
      }
      if (cronRes.ok) {
        const list = cronRes.result as { jobs: CronJob[] }
        setCronJobs((list.jobs ?? []).filter((j) => j.agentId === agent.id))
      }
      if (configRes.ok) {
        const cfg = configRes.result as {
          parsed?: { models?: { defaults?: { primary?: string } } }
        }
        setDefaultModel(cfg.parsed?.models?.defaults?.primary ?? "")
      }
      if (toolsRes.ok) {
        // tools.catalog may return { tools: ToolEntry[] } or { groups: { tools: ToolEntry[] }[] }
        const r = toolsRes.result as {
          tools?: ToolEntry[]
          groups?: Array<{ tools?: ToolEntry[] }>
        }
        if (Array.isArray(r.tools)) {
          setTools(r.tools)
        } else if (Array.isArray(r.groups)) {
          setTools(r.groups.flatMap((g) => g.tools ?? []))
        }
      }
      // MEMORY.md content summary
      if (memoryRes.ok) {
        const content = (memoryRes.result as { content?: string })?.content ?? ""
        // Take first ~300 chars as summary
        setMemorySummary(content.slice(0, 300))
      }
      // Daily memory file count
      if (dailyRes.ok) {
        const list = (dailyRes as { ok: true; files: unknown[] }).files ?? []
        setDailyMemoryCount(list.length)
      }
    }).finally(() => setLoading(false))
  }, [open, agent])

  if (!agent) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[380px] sm:w-[380px] p-0 flex flex-col gap-0">
        <SheetHeader className="px-4 pt-5 pb-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12 shrink-0">
              <AvatarImage src={getAgentAvatarUrl(agent.id)} alt={agent.name} />
              <AvatarFallback className="text-sm font-medium bg-blue-100 text-blue-700">
                {agent.avatar}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base leading-tight">{agent.name}</SheetTitle>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate" title={agent.id}>
                {agent.id}
              </p>
            </div>
          </div>
        </SheetHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">加载中...</span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y">
            {/* 模型 */}
            <Section icon={<Server className="h-3.5 w-3.5" />} title="模型">
              <p className="text-sm text-muted-foreground">
                {defaultModel || "未配置"}
              </p>
            </Section>

            {/* 工具 */}
            <Section icon={<Wrench className="h-3.5 w-3.5" />} title={`工具 (${tools.length})`}>
              {tools.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {tools.map((tool) => (
                    <Badge
                      key={tool.name}
                      variant="secondary"
                      className="text-[11px] px-1.5 py-0.5 h-auto font-mono"
                      title={tool.description}
                    >
                      {tool.name}
                      {tool.source === "plugin" && tool.pluginId && (
                        <span className="ml-1 opacity-50 text-[9px]">plug</span>
                      )}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">暂无工具数据</p>
              )}
            </Section>

            {/* 记忆 */}
            <Section icon={<Brain className="h-3.5 w-3.5" />} title="记忆">
              {memorySummary ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6 leading-relaxed">
                    {memorySummary}{memorySummary.length >= 300 ? "..." : ""}
                  </p>
                  {dailyMemoryCount > 0 && (
                    <p className="text-[11px] text-muted-foreground/70">
                      {dailyMemoryCount} 条每日记忆
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {dailyMemoryCount > 0
                    ? `${dailyMemoryCount} 条每日记忆`
                    : "暂无记忆数据"}
                </p>
              )}
            </Section>

            {/* 工作空间 */}
            <Section icon={<FolderOpen className="h-3.5 w-3.5" />} title="工作空间">
              {workspace && (
                <p className="text-xs text-muted-foreground font-mono break-all mb-2" title={workspace}>
                  {workspace}
                </p>
              )}
              {files.length > 0 ? (
                <div className="space-y-1">
                  {files.map((file) => (
                    <div
                      key={file.name}
                      className="flex items-center justify-between gap-2 py-0.5"
                    >
                      <span className="text-xs font-mono text-foreground/80">{file.name}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {file.missing ? (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-yellow-600 border-yellow-400">
                            缺失
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            {file.size != null ? formatSize(file.size) : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">暂无文件</p>
              )}
            </Section>

            {/* 定时任务 */}
            <Section icon={<Clock className="h-3.5 w-3.5" />} title="定时任务">
              {cronJobs.length > 0 ? (
                <div className="space-y-2">
                  {cronJobs.map((job) => (
                    <div key={job.id} className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{job.name}</p>
                        <p className="text-[11px] text-muted-foreground">{formatSchedule(job)}</p>
                      </div>
                      <Badge
                        variant={job.enabled ? "default" : "secondary"}
                        className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                      >
                        {job.enabled ? "启用" : "停用"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">暂无定时任务</p>
              )}
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </h3>
      </div>
      {children}
    </div>
  )
}
