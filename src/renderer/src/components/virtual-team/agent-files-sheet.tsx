import { useCallback, useEffect, useState } from "react"
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderClosed,
  FolderOpen,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { getAgentAvatarUrl } from "@/lib/avatar"
import { AGENT_FILE_NAMES } from "@/lib/agents/agentFiles"
import { useI18n } from "@/i18n"
import type { Agent } from "@/types"

// ── Types ────────────────────────────────────────────────────────────────────

type TreeNode = {
  name: string
  type: "file" | "dir"
  path: string
  size?: number
  updatedAtMs?: number
  children?: TreeNode[]
}

type SelectedFile = {
  path: string
  name: string
  isBootstrap: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const BOOTSTRAP_SET = new Set<string>(AGENT_FILE_NAMES)

function isBootstrapFile(node: TreeNode): boolean {
  return node.type === "file" && !node.path.includes("/") && BOOTSTRAP_SET.has(node.name)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── AgentFilesSheet ──────────────────────────────────────────────────────────

interface AgentFilesSheetProps {
  agent: Agent | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AgentFilesSheet({ agent, open, onOpenChange }: AgentFilesSheetProps) {
  const { t } = useI18n()
  const [view, setView] = useState<"list" | "editor">("list")
  const [tree, setTree] = useState<TreeNode[]>([])
  const [workspace, setWorkspace] = useState("")
  const [loadingList, setLoadingList] = useState(false)
  const [loadingFile, setLoadingFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editContent, setEditContent] = useState("")
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [fileError, setFileError] = useState<string | null>(null)

  const loadFiles = useCallback(async () => {
    if (!agent) return
    setLoadingList(true)
    try {
      const res = await window.ipc.agentsWorkspaceTree({ agentId: agent.id })
      if (res.ok) {
        setWorkspace(res.workspace ?? "")
        setTree(res.tree ?? [])
      } else {
        toast.error(res.error ?? t("workspace.saveFailed"))
      }
    } finally {
      setLoadingList(false)
    }
  }, [agent, t])

  useEffect(() => {
    if (open && agent) {
      setView("list")
      setSelected(null)
      setFileError(null)
      loadFiles()
    }
  }, [open, agent, loadFiles])

  const openFile = async (file: SelectedFile) => {
    if (!agent) return
    setSelected(file)
    setView("editor")
    setLoadingFile(true)
    setFileError(null)
    try {
      if (file.isBootstrap) {
        const res = await window.ipc.agentsFilesGet({ agentId: agent.id, name: file.name })
        if (res.ok) {
          const c = (res.result as { file?: { content?: string } })?.file?.content ?? ""
          setEditContent(c)
        } else {
          setEditContent("")
        }
      } else {
        const res = await window.ipc.agentsWorkspaceRead({ agentId: agent.id, filePath: file.path })
        if (res.ok) {
          if (res.binary) {
            setEditContent("")
            setFileError(t("workspace.binaryFile"))
          } else if (res.tooLarge) {
            setEditContent("")
            setFileError(t("workspace.fileTooLarge"))
          } else {
            const c = res.content ?? ""
            setEditContent(c)
          }
        } else {
          setEditContent("")
          setFileError(res.error ?? "")
        }
      }
    } finally {
      setLoadingFile(false)
    }
  }

  const saveFile = async () => {
    if (!selected || !selected.isBootstrap || !agent) return
    setSaving(true)
    try {
      const res = await window.ipc.agentsFilesSet({
        agentId: agent.id,
        name: selected.name,
        content: editContent,
      })
      if (res.ok) {
        toast.success(`${selected.name} ${t("workspace.saved")}`)
        loadFiles()
      } else {
        toast.error((res as { error?: string }).error ?? t("workspace.saveFailed"))
      }
    } finally {
      setSaving(false)
    }
  }

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      return next
    })
  }

  const renderTree = (nodes: TreeNode[], depth: number) =>
    nodes.map((node) => {
      if (node.type === "dir") {
        const isExpanded = expandedDirs.has(node.path)
        return (
          <div key={node.path}>
            <button
              className="w-full flex items-center gap-2 py-2.5 hover:bg-muted/50 transition-colors text-left"
              style={{ paddingLeft: `${depth * 16 + 16}px`, paddingRight: "16px" }}
              onClick={() => toggleDir(node.path)}
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
              ) : (
                <FolderClosed className="h-4 w-4 text-amber-500 shrink-0" />
              )}
              <span className="text-sm font-medium truncate flex-1">{node.name}/</span>
              {node.children && node.children.length > 0 && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {node.children.length}
                </span>
              )}
            </button>
            {isExpanded && node.children && renderTree(node.children, depth + 1)}
          </div>
        )
      }

      const bootstrap = isBootstrapFile(node)
      return (
        <div
          key={node.path}
          className="group flex items-center gap-2 py-2.5 hover:bg-muted/50 transition-colors"
          style={{ paddingLeft: `${depth * 16 + 16}px`, paddingRight: "16px" }}
        >
          <button
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
            onClick={() => openFile({ path: node.path, name: node.name, isBootstrap: bootstrap })}
          >
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-mono">{node.name}</p>
              {node.size != null && (
                <p className="text-xs text-muted-foreground">{formatSize(node.size)}</p>
              )}
            </div>
          </button>
          <button
            className="h-6 w-6 shrink-0 flex items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-accent transition-all"
            title={t("workspace.openExternal")}
            onClick={(e) => {
              e.stopPropagation()
              if (agent) window.ipc.agentsWorkspaceOpen({ agentId: agent.id, filePath: node.path })
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      )
    })

  if (!agent) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[440px] sm:w-[440px] p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-3 border-b shrink-0">
          <div className="flex items-center gap-3">
            {view === "editor" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => { setView("list"); setSelected(null); setFileError(null) }}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-xs bg-blue-100 text-blue-700">
                {agent.avatar}
              </AvatarFallback>
              <AvatarImage src={getAgentAvatarUrl(agent.id)} />
            </Avatar>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-sm leading-tight">{agent.name}</SheetTitle>
              {view === "editor" && selected ? (
                <p className="text-xs text-muted-foreground font-mono truncate">{selected.path}</p>
              ) : (
                workspace && (
                  <p className="text-xs text-muted-foreground truncate" title={workspace}>
                    {workspace}
                  </p>
                )
              )}
            </div>
            {view === "editor" && selected?.isBootstrap && (
              <Button size="sm" className="h-7 gap-1" onClick={saveFile} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {t("workspace.save")}
              </Button>
            )}
            {view === "editor" && selected && !selected.isBootstrap && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                {t("workspace.readonly")}
              </Badge>
            )}
            {view === "list" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                onClick={() => loadFiles()}
                disabled={loadingList}
                title={t("workspace.refresh")}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loadingList && "animate-spin")} />
              </Button>
            )}
          </div>
        </SheetHeader>

        {view === "list" ? (
          <ScrollArea className="flex-1">
            {loadingList ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">{t("workspace.loading")}</span>
              </div>
            ) : tree.length > 0 ? (
              <div className="py-1">{renderTree(tree, 0)}</div>
            ) : (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <p className="text-sm">{t("workspace.emptyFile")}</p>
              </div>
            )}
          </ScrollArea>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 p-3">
            {loadingFile ? (
              <div className="flex items-center justify-center flex-1 text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">{t("workspace.loading")}</span>
              </div>
            ) : fileError ? (
              <div className="flex items-center justify-center flex-1 text-muted-foreground">
                <p className="text-xs">{fileError}</p>
              </div>
            ) : (
              <Textarea
                className="flex-1 resize-none font-mono text-sm min-h-0"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                readOnly={!selected?.isBootstrap}
                placeholder={
                  selected?.isBootstrap
                    ? t("workspace.emptyFile")
                    : t("workspace.readonly")
                }
              />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
