import { useEffect, useState } from "react"
import { Info, AlertCircle, Loader2, RotateCcw, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface Skill {
  name: string
  description?: string
  version?: string
  enabled: boolean
}

function parseSkillsResult(raw: unknown): Skill[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.skills)
      ? ((raw as { skills: unknown[] }).skills)
      : []

  return list
    .map((s) => {
      if (typeof s === 'string') return { name: s, enabled: true }
      const sk = s as Record<string, unknown>
      return {
        name: typeof sk.name === 'string' ? sk.name : '',
        description: typeof sk.description === 'string' ? sk.description : undefined,
        version: typeof sk.version === 'string' ? sk.version : undefined,
        enabled: typeof sk.enabled === 'boolean' ? sk.enabled : true,
      }
    })
    .filter((s) => s.name)
}

interface AgentSkillsSectionProps {
  agentId: string
}

export function AgentSkillsSection({ agentId }: AgentSkillsSectionProps) {
  const [globalSkills, setGlobalSkills] = useState<Skill[]>([])
  // null = all skills enabled (no custom allowlist)
  // string[] = allowlist ([] = none allowed)
  const [allowlist, setAllowlist] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [skillsRes, agentRes] = await Promise.all([
        window.ipc.skillsList(),
        window.ipc.agentSkillsGet(agentId),
      ])
      if (skillsRes.ok) {
        setGlobalSkills(parseSkillsResult(skillsRes.result))
      }
      if (agentRes.ok) {
        setAllowlist(agentRes.skills)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (agentId) loadData()
  }, [agentId]) // eslint-disable-line react-hooks/exhaustive-deps

  const isAllowed = (name: string): boolean =>
    allowlist === null ? true : allowlist.includes(name)

  const hasCustomList = allowlist !== null

  const saveAllowlist = async (skills: string[] | null) => {
    setSaving(true)
    try {
      const res = await window.ipc.agentSkillsSet(agentId, skills)
      if (res.ok) {
        setAllowlist(skills)
      } else {
        toast.error((res as { ok: false; error: string }).error ?? '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (skillName: string, checked: boolean) => {
    // When unchecking any skill, create an allowlist from all currently allowed skills
    const base = allowlist ?? globalSkills.map((s) => s.name)
    const next = checked
      ? [...base, skillName]
      : base.filter((s) => s !== skillName)
    // If all skills are checked again, revert to "all enabled" (null)
    const allEnabled = globalSkills.every((s) => next.includes(s.name))
    await saveAllowlist(allEnabled ? null : next)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm">加载中...</span>
      </div>
    )
  }

  if (globalSkills.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        暂无可用技能
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 overflow-y-auto overflow-x-hidden">
      {/* Hint message */}
      <div
        className={cn(
          "flex items-start gap-2 rounded-md px-3 py-2 text-xs",
          hasCustomList
            ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
            : "bg-muted/60 text-muted-foreground"
        )}
      >
        {hasCustomList ? (
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        ) : (
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        )}
        <span>
          {hasCustomList
            ? "该智能体使用自定义技能允许列表。"
            : "所有技能已启用。禁用任何技能将创建该智能体的专属允许列表。"}
        </span>
      </div>

      {/* Skill checkboxes */}
      <div className="space-y-0.5">
        {globalSkills.map((skill) => {
          const allowed = isAllowed(skill.name)
          return (
            <label
              key={skill.name}
              className={cn(
                "flex w-full items-start gap-3 px-2 py-2 rounded-md cursor-pointer transition-colors",
                "hover:bg-accent/50",
                (saving) && "opacity-50 pointer-events-none"
              )}
            >
              <input
                type="checkbox"
                checked={allowed}
                onChange={(e) => handleToggle(skill.name, e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 accent-primary"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-medium truncate" title={skill.name}>{skill.name}</span>
                  {skill.version && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      v{skill.version}
                    </span>
                  )}
                  {!skill.enabled && (
                    <span className="text-[10px] text-orange-500">全局已禁用</span>
                  )}
                </div>
                {skill.description && (
                  <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2 break-all" title={skill.description}>
                    {skill.description}
                  </p>
                )}
              </div>
            </label>
          )
        })}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1 border-t">
        {hasCustomList && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            disabled={saving}
            onClick={() => saveAllowlist(null)}
          >
            <RotateCcw className="h-3 w-3" />
            恢复全部
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          disabled={saving}
          onClick={() => saveAllowlist([])}
        >
          <XCircle className="h-3 w-3" />
          全部禁用
        </Button>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {hasCustomList && (
        <p className="text-[10px] text-muted-foreground">
          配置已写入本地文件，重启 Gateway 后生效。
        </p>
      )}
    </div>
  )
}
