

import { AtSign, File, ImageIcon, Paperclip, RotateCcw, Send, Smile, Square, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { getSlashCommandCompletions, parseSlashCommand, type SlashCommandDef } from "@/lib/slash-commands"
import type { ChatAttachment } from "@/types"

interface MessageInputProps {
  onSend: (content: string, attachments?: ChatAttachment[]) => void
  onNewSession?: () => void
  onAbort?: () => void
  isGenerating?: boolean
  showMention?: boolean
  members?: { id: string; name: string }[]
  onMention?: (memberId: string) => void
  panelHeight?: number
  onAttachmentCountChange?: (count: number) => void
}

const emojis = ["😀", "😂", "😍", "🤔", "👍", "👌", "🙏", "🎉", "❤️", "🚀", "💡", "🔥", "✅", "🎯", "📝", "⚡", "💪", "🤝"]

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB

let attachmentCounter = 0
function generateAttachmentId(): string {
  return `att-${Date.now()}-${(++attachmentCounter).toString(36)}`
}

interface PendingMessage {
  id: string
  content: string
  attachments?: ChatAttachment[]
}

const MAX_QUEUE_SIZE = 3

export function MessageInput({ onSend, onNewSession, onAbort, isGenerating, showMention, members, panelHeight, onAttachmentCountChange }: MessageInputProps) {
  const { t } = useI18n()
  const [content, setContent] = useState("")
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [showMentionPopover, setShowMentionPopover] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [showSlashPopover, setShowSlashPopover] = useState(false)
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)
  const [slashFilter, setSlashFilter] = useState("")
  const [pendingQueue, setPendingQueue] = useState<PendingMessage[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const slashPopupRef = useRef<HTMLDivElement>(null)
  // 用 ref 访问最新值，避免 useEffect 依赖项问题
  const pendingQueueRef = useRef(pendingQueue)
  pendingQueueRef.current = pendingQueue
  const onSendRef = useRef(onSend)
  onSendRef.current = onSend

  // AI 回复结束时，自动发出队列里的第一条消息
  useEffect(() => {
    if (!isGenerating && pendingQueueRef.current.length > 0) {
      const [first, ...rest] = pendingQueueRef.current
      setPendingQueue(rest)
      onSendRef.current(first.content, first.attachments)
    }
  // 只监听 isGenerating 的变化，刻意不加 pendingQueue/onSend
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating])

  const slashCompletions = useMemo(() => getSlashCommandCompletions(slashFilter), [slashFilter])

  // 键盘导航时将选中项滚动到视图内
  useEffect(() => {
    const popup = slashPopupRef.current
    if (!popup || !showSlashPopover) return
    const selectedEl = popup.children[selectedSlashIndex] as HTMLElement | undefined
    selectedEl?.scrollIntoView({ block: 'nearest' })
  }, [selectedSlashIndex, showSlashPopover])

  const hasContent = content.trim().length > 0 || attachments.length > 0

  // ── Shared file processing ───────────────────────────────────────────────────
  const processFile = useCallback((file: File) => {
    if (file.type.startsWith("image/")) {
      // 图片：base64 编码后作为视觉附件发送
      if (file.size > MAX_IMAGE_SIZE) {
        toast.error(t("messageInput.imageTooLarge"))
        return
      }
      const reader = new FileReader()
      reader.addEventListener("load", () => {
        const dataUrl = reader.result as string
        setAttachments((prev) => [...prev, {
          id: generateAttachmentId(),
          dataUrl,
          mimeType: file.type,
          fileName: file.name || undefined,
        }])
      })
      reader.readAsDataURL(file)
    } else {
      // 非图片：用 webUtils.getPathForFile（Electron 32+ API，由 preload 暴露）
      const filePath = window.ipc.getFilePath(file)
      if (!filePath) {
        toast.error(t("messageInput.filePathUnavailable"))
        return
      }
      setAttachments((prev) => [...prev, {
        id: generateAttachmentId(),
        filePath,
        mimeType: file.type || "application/octet-stream",
        fileName: file.name || filePath.split(/[/\\]/).pop(),
      }])
    }
  }, [t])

  useEffect(() => {
    if (panelHeight !== undefined) return // 固定面板高度时 textarea 由 flex-1 控制，跳过自动高度
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [content, panelHeight])

  // 附件数量变化时通知父组件，以便父组件自动扩大面板高度
  useEffect(() => {
    onAttachmentCountChange?.(attachments.length)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments.length])

  const handleSend = useCallback(() => {
    if (!hasContent) return
    const trimmed = content.trim()

    // 本地斜杠命令直接执行，不发往 gateway
    if (trimmed.startsWith('/')) {
      const parsed = parseSlashCommand(trimmed)
      if (parsed?.command.executeLocal) {
        if (parsed.command.name === 'new') onNewSession?.()
        setContent('')
        setShowSlashPopover(false)
        return
      }
    }

    // AI 生成中 → 加入待发队列（最多 MAX_QUEUE_SIZE 条）
    if (isGenerating) {
      if (pendingQueue.length >= MAX_QUEUE_SIZE) return
      setPendingQueue((prev) => [
        ...prev,
        {
          id: `pq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          content: trimmed,
          attachments: attachments.length > 0 ? [...attachments] : undefined,
        },
      ])
      setContent("")
      setAttachments([])
      setShowSlashPopover(false)
      return
    }

    onSend(trimmed, attachments.length > 0 ? attachments : undefined)
    setContent("")
    setAttachments([])
    setShowSlashPopover(false)
  }, [content, attachments, hasContent, onSend, onNewSession, isGenerating, pendingQueue])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 斜杠命令弹窗的键盘导航（优先于其他快捷键）
    if (showSlashPopover && slashCompletions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedSlashIndex((prev) => Math.min(prev + 1, slashCompletions.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedSlashIndex((prev) => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        selectSlashCommand(slashCompletions[selectedSlashIndex])
        return
      }
      if (e.key === 'Escape') {
        setShowSlashPopover(false)
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }

    if (e.key === "Backspace" && members?.length) {
      const el = textareaRef.current
      if (!el) return
      const pos = el.selectionStart
      // 有选区时让浏览器默认处理
      if (pos !== el.selectionEnd) return
      const textBefore = content.slice(0, pos)
      // 检查光标前是否紧跟一个完整的 @member 或 @member（含尾部空格）
      for (const m of members) {
        const withSpace = `@${m.name} `
        const bare = `@${m.name}`
        const matched = textBefore.endsWith(withSpace)
          ? withSpace
          : textBefore.endsWith(bare)
            ? bare
            : null
        if (matched) {
          e.preventDefault()
          const newPos = pos - matched.length
          const newContent = content.slice(0, newPos) + content.slice(pos)
          setContent(newContent)
          // 恢复光标位置（setState 异步，需等渲染后设置）
          requestAnimationFrame(() => {
            el.selectionStart = newPos
            el.selectionEnd = newPos
          })
          return
        }
      }
    }

    if (e.key === "@" && showMention && members?.length) {
      setShowMentionPopover(true)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setContent(value)

    // 斜杠命令检测：内容以 / 开头且是单行、且尚未输入空格（正在键入命令名阶段）
    if (value.startsWith('/') && !value.includes('\n') && !value.slice(1).includes(' ')) {
      const filter = value.slice(1)
      const completions = getSlashCommandCompletions(filter)
      if (completions.length > 0) {
        setSlashFilter(filter)
        setShowSlashPopover(true)
        setSelectedSlashIndex(0)
      } else {
        setShowSlashPopover(false)
      }
    } else {
      setShowSlashPopover(false)
    }

    if (value.endsWith("@") && showMention && members?.length) {
      setShowMentionPopover(true)
    } else {
      setShowMentionPopover(false)
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageItems: DataTransferItem[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith("image/")) {
        imageItems.push(item)
      }
    }

    if (imageItems.length === 0) return

    e.preventDefault()

    for (const item of imageItems) {
      const file = item.getAsFile()
      if (!file) continue
      processFile(file)
    }
  }

  const handleFileSelect = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    for (let i = 0; i < files.length; i++) {
      processFile(files[i])
    }

    // Reset so same file can be selected again
    e.target.value = ""
  }

  // ── Drag & drop ─────────────────────────────────────────────────────────────
  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true)
    }
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    // relatedTarget 不在容器内时才视为真正离开（进入子元素不触发）
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragging(false)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)

    const files = e.dataTransfer.files
    if (!files) return
    for (let i = 0; i < files.length; i++) {
      processFile(files[i])
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id))
  }

  const selectSlashCommand = (cmd: SlashCommandDef) => {
    if (cmd.executeLocal) {
      if (cmd.name === 'new') onNewSession?.()
      setContent('')
      setShowSlashPopover(false)
    } else if (cmd.args) {
      // 有参数的命令：填入命令名 + 空格，让用户继续输入参数
      setContent(`/${cmd.name} `)
      setShowSlashPopover(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
    } else {
      // 无参数的 gateway 命令：直接发送
      onSend(`/${cmd.name}`)
      setContent('')
      setShowSlashPopover(false)
    }
  }

  const insertMention = (name: string) => {
    setContent((prev) => {
      const lastAt = prev.lastIndexOf("@")
      return lastAt >= 0 ? prev.slice(0, lastAt) + `@${name} ` : prev + `@${name} `
    })
    setShowMentionPopover(false)
    textareaRef.current?.focus()
  }

  const insertEmoji = (emoji: string) => {
    setContent((prev) => prev + emoji)
    textareaRef.current?.focus()
  }

  const triggerMention = () => {
    if (showMention && members?.length) {
      setContent((prev) => prev + "@")
      setShowMentionPopover(true)
      textareaRef.current?.focus()
    }
  }

  return (
    <div
      className={cn("border-t bg-background relative", panelHeight !== undefined && "flex flex-col")}
      style={panelHeight !== undefined ? { height: panelHeight } : undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop zone overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-b-md border-2 border-dashed border-primary bg-primary/5 pointer-events-none">
          <ImageIcon className="h-8 w-8 text-primary/60" />
          <span className="text-sm text-primary/80 font-medium">{t("messageInput.dropToAttach")}</span>
        </div>
      )}

      {/* Attachment Preview */}
      {attachments.length > 0 && (
        <div className={cn("px-4 pt-3 pb-1 flex gap-2 flex-wrap", panelHeight !== undefined && "shrink-0")}>
          {attachments.map((att) => (
            <div key={att.id} className="relative group">
              {att.dataUrl ? (
                // 图片缩略图
                <>
                  <img
                    src={att.dataUrl}
                    alt={att.fileName ?? "attachment preview"}
                    className="h-16 w-16 rounded-md object-cover border border-border"
                  />
                  {att.fileName && (
                    <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md">
                      <p className="text-[9px] text-white truncate leading-tight">{att.fileName}</p>
                    </div>
                  )}
                </>
              ) : (
                // 非图片文件 chip
                <div className="flex items-center gap-1.5 h-16 pl-2.5 pr-7 rounded-md border border-border bg-muted/60 max-w-[160px]">
                  <File className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="text-xs text-foreground truncate leading-tight">{att.fileName}</span>
                </div>
              )}
              <button
                type="button"
                className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => removeAttachment(att.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pending queue — 待发消息列表 */}
      {pendingQueue.length > 0 && (
        <div className={cn("px-4 pt-2 space-y-1", panelHeight !== undefined && "shrink-0")}>
          {pendingQueue.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-amber-500/8 border border-amber-500/20 text-xs"
            >
              <span className="shrink-0 text-amber-500/70 font-medium tabular-nums">{index + 1}/{MAX_QUEUE_SIZE}</span>
              <span className="flex-1 truncate text-foreground/70">{item.content}</span>
              {item.attachments && item.attachments.length > 0 && (
                <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground/50" />
              )}
              <button
                type="button"
                className="shrink-0 h-4 w-4 flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
                onClick={() => setPendingQueue((prev) => prev.filter((q) => q.id !== item.id))}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Textarea */}
      <div className={cn(panelHeight !== undefined ? "flex-1 min-h-0 px-4 pt-2 pb-1 overflow-hidden" : "px-4 pt-3 pb-1")}>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            attachments.length > 0
              ? t("messageInput.placeholders.withAttachments")
              : t("messageInput.placeholders.default")
          }
          onBlur={() => { setShowMentionPopover(false); setShowSlashPopover(false) }}
          className={cn(
            "w-full resize-none border-0 bg-transparent px-0 py-1 text-sm leading-5 focus:outline-none placeholder:text-muted-foreground/50 overflow-y-auto",
            panelHeight !== undefined ? "h-full" : "min-h-[36px] max-h-[200px]"
          )}
          rows={1}
        />
      </div>

      {/* Hidden file input — accepts all files; images go as base64, others via local path */}
      <input
        ref={fileInputRef}
        type="file"
        accept="*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Toolbar */}
      <div className={cn("flex items-center justify-between px-3 pb-2.5", panelHeight !== undefined && "shrink-0")}>
        <div className="flex items-center gap-0.5">
          <Popover>
            <PopoverTrigger
              render={<button type="button" className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors" />}
            >
              <Smile className="h-4 w-4" />
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2" align="start" side="top">
              <div className="grid grid-cols-6 gap-1">
                {emojis.map((emoji) => (
                  <button
                    key={emoji}
                    className="text-xl p-1.5 rounded hover:bg-accent transition-colors"
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {showMention && (
            <ToolbarButton icon={<AtSign className="h-4 w-4" />} tooltip={t("messageInput.toolbar.mention")} onClick={triggerMention} />
          )}

          {/* @提及下拉列表：绝对定位，锚在输入区左下角正上方 */}
          {showMention && showMentionPopover && members && members.length > 0 && (
            <div className="absolute bottom-full left-0 mb-1 w-48 bg-popover border border-border rounded-md shadow-md p-1 z-50">
              {members.map((m) => (
                <button
                  key={m.id}
                  className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-accent transition-colors"
                  onMouseDown={(e) => {
                    // 阻止 blur 导致 popover 提前关闭
                    e.preventDefault()
                    insertMention(m.name)
                  }}
                >
                  @{m.name}
                </button>
              ))}
            </div>
          )}

          {/* 斜杠命令自动补全弹窗 */}
          {showSlashPopover && slashCompletions.length > 0 && (
            <div ref={slashPopupRef} className="absolute bottom-full left-0 mb-1 w-80 max-h-64 overflow-y-auto bg-popover border border-border rounded-md shadow-md p-1 z-50">
              {slashCompletions.map((cmd, index) => (
                <button
                  key={cmd.name}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm rounded flex items-baseline gap-2 transition-colors",
                    index === selectedSlashIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent hover:text-accent-foreground"
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectSlashCommand(cmd)
                  }}
                  onMouseEnter={() => setSelectedSlashIndex(index)}
                >
                  <span className="font-mono text-primary font-medium shrink-0 text-xs">/{cmd.name}</span>
                  <span className="text-muted-foreground text-xs min-w-0 leading-5">
                    {cmd.description}
                    {cmd.args && (
                      <span className="ml-1 text-muted-foreground/50">{cmd.args}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}

          <ToolbarButton icon={<Paperclip className="h-4 w-4" />} tooltip={t("messageInput.toolbar.attachment")} onClick={handleFileSelect} />

          {onNewSession && (
            <ToolbarButton icon={<RotateCcw className="h-4 w-4" />} tooltip={t("messageInput.toolbar.newSession")} onClick={onNewSession} />
          )}
        </div>

        <div className="flex items-center gap-1">
          {isGenerating && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 rounded-md gap-1 text-xs font-medium text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              onClick={onAbort}
            >
              <Square className="h-3 w-3 fill-current" />
              停止
            </Button>
          )}

          <Button
            size="sm"
            className={cn(
              "h-7 px-3 rounded-md gap-1 text-xs font-medium transition-colors",
              hasContent && !(isGenerating && pendingQueue.length >= MAX_QUEUE_SIZE)
                ? "bg-[#3370ff] hover:bg-[#2860e0] text-white"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
            onClick={handleSend}
            disabled={!hasContent || (isGenerating && pendingQueue.length >= MAX_QUEUE_SIZE)}
          >
            <Send className="h-3.5 w-3.5" />
            {t("messageInput.toolbar.send")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ToolbarButton({
  icon,
  tooltip,
  onClick,
  unavailable = false,
}: {
  icon: React.ReactNode
  tooltip: string
  onClick?: () => void
  unavailable?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-disabled={unavailable}
            className={cn(
              "inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground transition-colors",
              unavailable
                ? "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-muted-foreground"
                : "hover:bg-accent hover:text-accent-foreground"
            )}
            onClick={onClick}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
