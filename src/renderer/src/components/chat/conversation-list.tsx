

import { Pin, Plus, Search, Trash2 } from "lucide-react"
import { useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { getAgentAvatarUrl, useAvatarVersion } from "@/lib/avatar"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app-context"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { GroupAvatar } from "./group-avatar"
import { NewConversationDialog } from "./new-conversation-dialog"
import { CreateGroupDialog } from "./create-group-dialog"
import type { Conversation } from "@/types"

interface ConversationListProps {}

export function ConversationList(_props: ConversationListProps) {
  const { state, dispatch } = useApp()
  const { t } = useI18n()
  const [search, setSearch] = useState("")
  const [newConvOpen, setNewConvOpen] = useState(false)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  useAvatarVersion() // re-render when avatar changes

  const filtered = state.conversations.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  )
  const pinnedConvs = filtered
    .filter((c) => c.pinned)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
  const unpinnedConvs = filtered.filter((c) => !c.pinned)

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* macOS 红绿灯占位区 */}
      {window.ipc.platform === 'darwin' && (
        <div
          className="h-11 shrink-0"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
      )}
      {/* 顶部搜索栏 — WeChat 风格 */}
      <div
        className="h-12 flex items-center px-3 gap-2 border-b shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div
          className="flex-1 relative"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
          <Input
            placeholder={t("common.searchPlaceholder")}
            className="h-8 pl-8 text-sm bg-muted/50 border-0 focus-visible:ring-1 rounded-md"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-accent"
              />
            }
          >
            <Plus className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onClick={() => setNewConvOpen(true)}>
              {t("newConversation.title").slice(0, 4)}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setGroupDialogOpen(true)}>
              {t("conversationList.createGroup")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      {/* 对话列表 */}
      <div
        className="flex-1 min-h-0 overflow-y-auto"
        style={filtered.length === 0 ? { WebkitAppRegion: "drag" } as React.CSSProperties : undefined}
      >
        {state.connectionStatus !== 'connected' ? (
          /* 未连接：connecting 显示骨架屏，disconnected/error 显示空白（右侧已有提示） */
          state.connectionStatus === 'connecting' ? (
            <div className="px-3 py-2 space-y-1">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-1 py-2">
                  <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-2.5 w-36" />
                  </div>
                </div>
              ))}
            </div>
          ) : null
        ) : (
        <>

        {/* 置顶区域 - 网格头像样式 */}
        {pinnedConvs.length > 0 && (
          <div className="px-2 pt-1 pb-2">
            <div className="flex flex-wrap gap-x-1 gap-y-1">
              {pinnedConvs.map((conv) => {
                const members = conv.members.map((id) => {
                  if (id === "user") return { id, name: t("common.meHuman") }
                  const agent = state.agents.find((a) => a.id === id)
                  return agent ? { id: agent.id, name: agent.name } : { id, name: id }
                })
                return (
                  <ContextMenu key={conv.id}>
                    <ContextMenuTrigger>
                      <button
                        onClick={() =>
                          dispatch({ type: "SET_ACTIVE_CONVERSATION", payload: conv.id })
                        }
                        className={cn(
                          "flex flex-col items-center gap-1.5 w-[62px] rounded-lg py-1.5 px-1 transition-colors",
                          "hover:bg-accent/50",
                          state.activeConversationId === conv.id && "bg-accent"
                        )}
                      >
                        <div className="relative">
                          {conv.type === "group" ? (
                            <GroupAvatar members={members} size={46} />
                          ) : (
                            <Avatar className="h-[46px] w-[46px]">
                              <AvatarImage
                                src={getAgentAvatarUrl(conv.members[0] ?? "")}
                                alt={conv.name}
                              />
                              <AvatarFallback className="text-sm font-medium bg-blue-100 text-blue-700">
                                {conv.avatar}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          {conv.unreadCount > 0 && (
                            <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 flex items-center justify-center rounded-full bg-[#3370ff] text-[9px] text-white font-medium">
                              {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-muted-foreground truncate w-full text-center leading-tight">
                          {conv.name.length > 5 ? conv.name.slice(0, 5) + "..." : conv.name}
                        </span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onClick={() =>
                          dispatch({ type: "TOGGLE_PIN", payload: { conversationId: conv.id } })
                        }
                      >
                        <Pin className="h-4 w-4" />
                        {t("conversationList.unpin")}
                      </ContextMenuItem>
                      {conv.type === "group" && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            variant="destructive"
                            onClick={() =>
                              dispatch({ type: "DISSOLVE_GROUP", payload: { conversationId: conv.id } })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                            {t("conversationList.dissolveGroup")}
                          </ContextMenuItem>
                        </>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })}
            </div>
          </div>
        )}

        {/* 普通会话列表 */}
        <div className="px-2 py-1">
          {unpinnedConvs.map((conv) => {
            const members = conv.members.map((id) => {
              if (id === "user") return { id, name: t("common.meHuman") }
              const agent = state.agents.find((a) => a.id === id)
              return agent ? { id: agent.id, name: agent.name } : { id, name: id }
            })
            return (
              <ContextMenu key={conv.id}>
                <ContextMenuTrigger>
                  <ConversationItem
                    conversation={conv}
                    members={members}
                    isActive={state.activeConversationId === conv.id}
                    onClick={() =>
                      dispatch({ type: "SET_ACTIVE_CONVERSATION", payload: conv.id })
                    }
                  />
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onClick={() =>
                      dispatch({ type: "TOGGLE_PIN", payload: { conversationId: conv.id } })
                    }
                  >
                    <Pin className="h-4 w-4" />
                    {t("conversationList.pin")}
                  </ContextMenuItem>
                  {conv.type === "group" && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() =>
                          dispatch({ type: "DISSOLVE_GROUP", payload: { conversationId: conv.id } })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                        {t("conversationList.dissolveGroup")}
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            )
          })}
        </div>
        </>
        )}
      </div>
      <NewConversationDialog open={newConvOpen} onOpenChange={setNewConvOpen} />
      <CreateGroupDialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen} />
    </div>
  )
}

function ConversationItem({
  conversation,
  members,
  isActive,
  onClick,
}: {
  conversation: Conversation
  members: { id: string; name: string }[]
  isActive: boolean
  onClick: () => void
}) {
  const { t } = useI18n()
  const isGroup = conversation.type === "group"

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
        "hover:bg-accent/50",
        isActive && "bg-accent"
      )}
    >
      {isGroup ? (
        <GroupAvatar members={members} size={42} />
      ) : (
        <Avatar className="h-[42px] w-[42px] shrink-0">
          <AvatarImage src={getAgentAvatarUrl(conversation.members[0] ?? "")} alt={conversation.name} />
          <AvatarFallback className="text-sm font-medium bg-blue-100 text-blue-700">
            {conversation.avatar}
          </AvatarFallback>
        </Avatar>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn(
              "text-sm truncate",
              conversation.unreadCount > 0 ? "font-semibold" : "font-medium"
            )}>
              {conversation.name}
            </span>
            {conversation.type === "direct" && (
              <Badge
                variant="secondary"
                className="h-[16px] px-1 text-[10px] shrink-0 rounded bg-blue-500/10 text-blue-600 border-blue-200 font-medium"
              >
                AI
              </Badge>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground/60 shrink-0">
            {conversation.lastMessageTime}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={cn(
            "text-xs truncate",
            conversation.unreadCount > 0 ? "text-foreground/60" : "text-muted-foreground"
          )}>
            {conversation.type === "group" && conversation.lastMessageSender
              ? `${conversation.lastMessageSender}: `
              : ""}
            {conversation.lastMessage ?? t("conversationList.noMessages")}
          </p>
          {conversation.unreadCount > 0 && (
            <Badge
              variant="default"
              className="h-[18px] min-w-[18px] px-1 text-[10px] shrink-0 rounded-full bg-[#3370ff]"
            >
              {conversation.unreadCount > 99
                ? "99+"
                : conversation.unreadCount}
            </Badge>
          )}
        </div>
      </div>
    </button>
  )
}
