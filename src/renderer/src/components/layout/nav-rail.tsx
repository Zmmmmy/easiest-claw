

import { useEffect, useRef, useState } from "react"
import { Activity, Blocks, Bot, Clock, Loader2, MessageSquare, MessageSquarePlus, Puzzle, Radio, Settings, UserPlus, Users } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"
import { getUserAvatarUrl, getUserName, setUserAvatar, useAvatarVersion } from "@/lib/avatar"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app-context"
import { SettingsDialog } from "@/components/settings/settings-dialog"
import { CreateAgentDialog } from "@/components/virtual-team/create-agent-dialog"
import { CreateGroupDialog } from "@/components/chat/create-group-dialog"
import { NewConversationDialog } from "@/components/chat/new-conversation-dialog"
import type { ViewType } from "@/types"

interface NavItem {
  id: ViewType
  label: string
  icon: React.ReactNode
  unavailable?: boolean
}

export function NavRail() {
  const { state, dispatch } = useApp()
  const { t } = useI18n()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newAgentOpen, setNewAgentOpen] = useState(false)
  const [newConvOpen, setNewConvOpen] = useState(false)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [avatarConfirmOpen, setAvatarConfirmOpen] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  useAvatarVersion()

  // 响应跨组件的"打开设置"请求（如：创建 Agent 时无模型配置）
  useEffect(() => {
    const handler = () => setSettingsOpen(true)
    window.addEventListener("tg:open-settings", handler)
    return () => window.removeEventListener("tg:open-settings", handler)
  }, [])

  const handleUserAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""

    if (!file) return

    if (!file.type.startsWith("image/")) {
      toast.error(t("header.selectImageFile"))
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("header.imageSizeLimit"))
      return
    }

    setAvatarUploading(true)

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error("Failed to read file"))
        reader.readAsDataURL(file)
      })
      setUserAvatar(dataUrl)
      toast.success(t("header.personalAvatarUpdated"))
    } catch {
      toast.error(t("header.networkError"))
    } finally {
      setAvatarUploading(false)
    }
  }

  const handleAvatarConfirm = () => {
    setAvatarConfirmOpen(false)
    fileInputRef.current?.click()
  }

  const navItems: NavItem[] = [
    {
      id: "chat",
      label: t("nav.chat"),
      icon: <MessageSquare className="h-5 w-5" />,
    },
    {
      id: "virtual-team",
      label: t("nav.virtualTeam"),
      icon: <Users className="h-5 w-5" />,
    },
    {
      id: "cron",
      label: t("nav.cron"),
      icon: <Clock className="h-5 w-5" />,
    },
    {
      id: "openclaw",
      label: t("nav.openclaw"),
      icon: (
        <div className="relative">
          <Activity className="h-5 w-5" />
          <span
            className={cn(
              "absolute -top-1 -right-1 h-2 w-2 rounded-full border border-background",
              state.connectionStatus === "connected" && "bg-green-500",
              state.connectionStatus === "connecting" && "bg-yellow-500 animate-pulse",
              state.connectionStatus === "error" && "bg-destructive",
              (!state.connectionStatus || state.connectionStatus === "disconnected") && "bg-muted-foreground/50"
            )}
          />
        </div>
      ),
    },
    {
      id: "skills",
      label: "Skills",
      icon: <Puzzle className="h-5 w-5" />,
    },
    {
      id: "agent-config",
      label: "Agent 配置",
      icon: <Bot className="h-5 w-5" />,
    },
    {
      id: "channels",
      label: t("nav.channels"),
      icon: <Radio className="h-5 w-5" />,
    },
    {
      id: "plugins",
      label: t("nav.plugins"),
      icon: <Blocks className="h-5 w-5" />,
    },
  ]

  return (
    <div className="shrink-0 w-[56px] flex flex-col border-r bg-muted/50">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleUserAvatarChange}
      />

      {/* macOS 红绿灯占位区 — 与 conversation-list 对齐 */}
      {window.ipc.platform === "darwin" && (
        <div
          className="h-11 shrink-0"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
      )}

      {/* 顶部区域 — h-12，与会话列表头部和聊天头部对齐；设为可拖拽窗口区 */}
      <div
        className="h-12 shrink-0 flex items-center justify-center"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
                onClick={() => setAvatarConfirmOpen(true)}
                disabled={avatarUploading}
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              />
            }
          >
            <div className="relative">
              <Avatar className="h-9 w-9">
                <AvatarImage src={getUserAvatarUrl()} alt={getUserName() || t("common.me")} />
                <AvatarFallback className="text-xs font-medium bg-green-100 text-green-700">
                  {getUserName().charAt(0).toUpperCase() || t("common.me")}
                </AvatarFallback>
              </Avatar>
              {avatarUploading && (
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/35 text-white">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
              {getUserName() || t("nav.changeMyAvatar")}
            </TooltipContent>
        </Tooltip>
      </div>

      {/* Nav content */}
      <div className="flex flex-col items-center py-2 gap-1 flex-1">

      {/* Nav Items */}
      {navItems.map((item) => (
        <Tooltip key={item.id}>
          <TooltipTrigger
            render={
              <button
                aria-disabled={item.unavailable}
                onClick={() => {
                  if (item.unavailable) {
                    toast.info(t("header.unavailableAction", { action: item.label }))
                    return
                  }
                  dispatch({ type: "SET_VIEW", payload: item.id })
                }}
                className={cn(
                  "flex items-center justify-center w-10 h-10 rounded-lg transition-colors",
                  item.unavailable
                    ? "cursor-not-allowed opacity-45 text-muted-foreground"
                    : "hover:bg-accent",
                  !item.unavailable && state.view === item.id
                    ? "bg-accent text-primary"
                    : "text-muted-foreground"
                )}
              />
            }
          >
            {item.icon}
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* 添加新成员 */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-lg text-muted-foreground hover:bg-accent"
              onClick={() => setNewAgentOpen(true)}
            />
          }
        >
          <UserPlus className="h-5 w-5" />
        </TooltipTrigger>
        <TooltipContent side="right">{t("conversationList.addNewMember")}</TooltipContent>
      </Tooltip>

      {/* 创建群组 */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-lg text-muted-foreground hover:bg-accent"
              onClick={() => setGroupDialogOpen(true)}
            />
          }
        >
          <MessageSquarePlus className="h-5 w-5" />
        </TooltipTrigger>
        <TooltipContent side="right">{t("conversationList.createGroup")}</TooltipContent>
      </Tooltip>

      {/* Settings at bottom */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-lg text-muted-foreground hover:bg-accent"
              onClick={() => setSettingsOpen(true)}
            />
          }
        >
          <div className="relative">
            <Settings className="h-5 w-5" />
            {!state.modelsConfigured && (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">{t("nav.settings")}</TooltipContent>
      </Tooltip>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <CreateAgentDialog open={newAgentOpen} onOpenChange={setNewAgentOpen} />
      <CreateGroupDialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen} />
      <NewConversationDialog open={newConvOpen} onOpenChange={setNewConvOpen} />

      <AlertDialog open={avatarConfirmOpen} onOpenChange={setAvatarConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("nav.changeMyAvatar")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("nav.changeMyAvatarDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleAvatarConfirm}>
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  )
}
