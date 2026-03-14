

import { useEffect, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { getAgentAvatarUrl } from "@/lib/avatar"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCronMutations } from "@/hooks/use-cron"
import { useApp } from "@/store/app-context"
import type { CronJob, CronJobCreateInput, CronSchedule } from "@/types/cron"

type ScheduleKind = "every" | "cron"

interface CronJobFormProps {
  editingJob?: CronJob | null
  onCreated: () => void
  onCancelEdit?: () => void
}

function parseScheduleToForm(schedule: CronSchedule): {
  kind: ScheduleKind
  intervalValue: string
  intervalUnit: "seconds" | "minutes" | "hours"
  cronExpr: string
} {
  if (schedule.kind === "cron") {
    return { kind: "cron", intervalValue: "30", intervalUnit: "minutes", cronExpr: schedule.expr }
  }
  if (schedule.kind === "every") {
    const ms = schedule.everyMs
    if (ms >= 3_600_000 && ms % 3_600_000 === 0) {
      return { kind: "every", intervalValue: String(ms / 3_600_000), intervalUnit: "hours", cronExpr: "" }
    }
    if (ms >= 60_000 && ms % 60_000 === 0) {
      return { kind: "every", intervalValue: String(ms / 60_000), intervalUnit: "minutes", cronExpr: "" }
    }
    return { kind: "every", intervalValue: String(Math.round(ms / 1000)), intervalUnit: "seconds", cronExpr: "" }
  }
  return { kind: "every", intervalValue: "30", intervalUnit: "minutes", cronExpr: "" }
}

export function CronJobForm({ editingJob, onCreated, onCancelEdit }: CronJobFormProps) {
  const { state } = useApp()
  const { addJob, updateJob, loading, error } = useCronMutations()

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [agentId, setAgentId] = useState("")
  const [agentOpen, setAgentOpen] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [message, setMessage] = useState("")

  // Schedule
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>("every")
  const [intervalValue, setIntervalValue] = useState("30")
  const [intervalUnit, setIntervalUnit] = useState<"seconds" | "minutes" | "hours">("minutes")
  const [cronExpr, setCronExpr] = useState("")

  const isEditing = Boolean(editingJob)

  // Pre-fill form when editingJob changes
  useEffect(() => {
    if (editingJob) {
      setName(editingJob.name)
      setDescription(editingJob.description ?? "")
      setAgentId(editingJob.agentId ?? "")
      setEnabled(editingJob.enabled)
      setMessage(editingJob.payload.kind === "agentTurn" ? editingJob.payload.message : "")
      const parsed = parseScheduleToForm(editingJob.schedule)
      setScheduleKind(parsed.kind)
      setIntervalValue(parsed.intervalValue)
      setIntervalUnit(parsed.intervalUnit)
      setCronExpr(parsed.cronExpr)
    }
  }, [editingJob])

  const resetForm = () => {
    setName("")
    setDescription("")
    setAgentId("")
    setEnabled(true)
    setMessage("")
    setScheduleKind("every")
    setIntervalValue("30")
    setIntervalUnit("minutes")
    setCronExpr("")
  }

  const buildSchedule = (): CronSchedule => {
    if (scheduleKind === "cron") {
      return { kind: "cron", expr: cronExpr }
    }
    const num = Number(intervalValue) || 30
    const multiplier =
      intervalUnit === "seconds"
        ? 1000
        : intervalUnit === "minutes"
          ? 60_000
          : 3_600_000
    return { kind: "every", everyMs: num * multiplier }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !agentId.trim()) return

    if (isEditing && editingJob) {
      const patch: Record<string, unknown> = {
        name: name.trim(),
        agentId: agentId.trim(),
        description: description.trim() || undefined,
        enabled,
        schedule: buildSchedule(),
        payload: {
          kind: "agentTurn",
          message: message.trim() || name.trim(),
        },
      }
      const ok = await updateJob(editingJob.id, patch)
      if (ok) {
        resetForm()
        onCancelEdit?.()
        onCreated()
      }
    } else {
      const input: CronJobCreateInput = {
        name: name.trim(),
        agentId: agentId.trim(),
        description: description.trim() || undefined,
        enabled,
        schedule: buildSchedule(),
        sessionTarget: "isolated",
        wakeMode: "next-heartbeat",
        payload: {
          kind: "agentTurn",
          message: message.trim() || name.trim(),
        },
      }
      const result = await addJob(input)
      if (result) {
        resetForm()
        onCreated()
      }
    }
  }

  const handleCancel = () => {
    resetForm()
    onCancelEdit?.()
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">
          {isEditing ? "编辑任务" : "新建任务"}
        </h2>
        {isEditing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground"
            onClick={handleCancel}
          >
            取消编辑
          </Button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="text-xs text-destructive p-2 rounded-md bg-destructive/10">
            {error}
          </div>
        )}

        {/* Row 1: Name + Description + Agent + Enabled */}
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-xs">
              名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="晨间简报"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">描述</Label>
            <Input
              placeholder="可选说明"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              代理 <span className="text-destructive">*</span>
            </Label>
            <Popover open={agentOpen} onOpenChange={setAgentOpen}>
              <PopoverTrigger
                className="flex h-8 w-full items-center justify-between rounded-md border bg-background px-2 text-sm hover:bg-accent/50 cursor-pointer"
              >
                {agentId ? (
                  <span className="flex items-center gap-1.5 truncate">
                    <Avatar className="h-5 w-5">
                      <AvatarImage
                        src={getAgentAvatarUrl(agentId)}
                        alt={agentId}
                      />
                      <AvatarFallback className="text-[9px] bg-blue-100 text-blue-700">
                        {agentId.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">
                      {state.agents.find((a) => a.id === agentId)?.name ?? agentId}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">选择代理...</span>
                )}
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[220px] p-1"
              >
                {state.agents.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    暂无可用代理
                  </div>
                ) : (
                  <div className="max-h-[200px] overflow-y-auto">
                    {state.agents.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent cursor-pointer"
                        onClick={() => {
                          setAgentId(agent.id)
                          setAgentOpen(false)
                        }}
                      >
                        <Avatar className="h-6 w-6">
                          <AvatarImage
                            src={getAgentAvatarUrl(agent.id)}
                            alt={agent.name}
                          />
                          <AvatarFallback className="text-[10px] bg-blue-100 text-blue-700">
                            {agent.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0 text-left">
                          <div className="truncate font-medium">{agent.name}</div>
                        </div>
                        {agentId === agent.id && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center gap-1.5 pb-0.5">
            <Checkbox
              id="enabled"
              checked={enabled}
              onCheckedChange={(v) => setEnabled(v === true)}
            />
            <Label htmlFor="enabled" className="text-xs cursor-pointer whitespace-nowrap">
              已启用
            </Label>
          </div>
        </div>

        {/* Row 2: Schedule - single row */}
        <div className="flex items-end gap-2">
          <div className="space-y-1 w-24">
            <Label className="text-xs">调度</Label>
            <Select value={scheduleKind} onValueChange={(v) => setScheduleKind(v as ScheduleKind)}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="every">每隔</SelectItem>
                <SelectItem value="cron">Cron</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scheduleKind === "every" ? (
            <>
              <div className="space-y-1 w-20">
                <Label className="text-xs">
                  每隔 <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="30"
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1 w-20">
                <Label className="text-xs">单位</Label>
                <Select value={intervalUnit} onValueChange={(v) => setIntervalUnit(v as "seconds" | "minutes" | "hours")}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="seconds">秒</SelectItem>
                    <SelectItem value="minutes">分钟</SelectItem>
                    <SelectItem value="hours">小时</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <div className="space-y-1 flex-1">
              <Label className="text-xs">
                Cron 表达式 <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="*/5 * * * *"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                className="h-8 text-sm font-mono"
              />
            </div>
          )}
        </div>

        {/* Row 3: Prompt message */}
        <div className="space-y-1">
          <Label className="text-xs">提示消息</Label>
          <Textarea
            placeholder="输入发送给代理的提示消息...（留空使用任务名称）"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="text-sm min-h-[60px] resize-none"
          />
        </div>

        <div className="flex gap-2">
          {isEditing && (
            <Button
              type="button"
              variant="outline"
              className="h-8 text-sm"
              onClick={handleCancel}
            >
              取消
            </Button>
          )}
          <Button
            type="submit"
            className="flex-1 h-8 text-sm"
            disabled={loading || !name.trim() || !agentId.trim()}
          >
            {loading
              ? (isEditing ? "保存中..." : "创建中...")
              : (isEditing ? "保存修改" : "创建任务")}
          </Button>
        </div>
      </form>
    </Card>
  )
}
