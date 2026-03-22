import { useState } from "react"
import { Brain, ChevronRight, Wrench, CheckCircle2, XCircle, AlertTriangle } from "lucide-react"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import type { ContentBlock } from "@/types"

/* ── Markdown 内容渲染（复用 message-bubble 的 MarkdownContent 逻辑） ───── */

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

function BlockMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed text-xs break-words">{children}</p>,
        pre: ({ children }) => (
          <pre className="bg-black/5 dark:bg-white/10 rounded p-2 overflow-x-auto my-1.5 text-xs font-mono w-full max-w-full whitespace-pre-wrap break-all">
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

/* ── 工具参数摘要（从 arguments 中提取关键信息作为标题后缀） ───────────── */

function toolCallSummary(_name: string, args: Record<string, unknown>): string {
  // 常见工具的路径/查询等关键参数
  const keyFields = ["path", "file_path", "filePath", "command", "query", "url", "pattern", "content"]
  for (const key of keyFields) {
    const val = args[key]
    if (typeof val === "string" && val.trim()) {
      const short = val.length > 60 ? val.slice(0, 57) + "..." : val
      return short
    }
  }
  return ""
}

/* ── 思考过程卡片 ─────────────────────────────────────────────────────── */

function ThinkingCard({ block }: { block: Extract<ContentBlock, { type: "thinking" }> }) {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()

  return (
    <div className="rounded-md border border-purple-200/60 dark:border-purple-800/40 bg-purple-50/40 dark:bg-purple-950/20 overflow-hidden my-1">
      <button
        type="button"
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left text-xs text-purple-700 dark:text-purple-300 hover:bg-purple-100/50 dark:hover:bg-purple-900/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")} />
        <Brain className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">{t("contentBlocks.thinking")}</span>
        {block.redacted && (
          <span className="text-muted-foreground ml-1">({t("contentBlocks.thinkingRedacted")})</span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-2.5 pt-0.5 text-xs text-purple-900/80 dark:text-purple-200/80 whitespace-pre-wrap max-h-64 overflow-y-auto border-t border-purple-200/40 dark:border-purple-800/30">
          {block.redacted ? t("contentBlocks.thinkingRedacted") : block.thinking}
        </div>
      )}
    </div>
  )
}

/* ── 工具调用卡片 ─────────────────────────────────────────────────────── */

function ToolCallCard({ block }: { block: Extract<ContentBlock, { type: "toolCall" }> }) {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()

  const summary = toolCallSummary(block.name, block.arguments)
  const hasResult = !!block.result
  const isError = block.result?.isError ?? false
  const resultText = hasResult ? extractResultText(block.result!.content) : ""

  return (
    <div className={cn(
      "rounded-md border overflow-hidden my-1 w-full max-w-full min-w-0",
      isError
        ? "border-red-200/60 dark:border-red-800/40 bg-red-50/30 dark:bg-red-950/20"
        : "border-blue-200/60 dark:border-blue-800/40 bg-blue-50/30 dark:bg-blue-950/20"
    )}>
      <button
        type="button"
        className={cn(
          "flex items-center gap-1.5 w-full min-w-0 px-2.5 py-1.5 text-left text-xs transition-colors",
          isError
            ? "text-red-700 dark:text-red-300 hover:bg-red-100/50 dark:hover:bg-red-900/30"
            : "text-blue-700 dark:text-blue-300 hover:bg-blue-100/50 dark:hover:bg-blue-900/30"
        )}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")} />
        <Wrench className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium shrink-0">{block.name}</span>
        {summary && (
          <span className="text-muted-foreground ml-1 min-w-0 flex-1 truncate">{summary}</span>
        )}
        {hasResult && (
          <span className="ml-auto shrink-0">
            {isError
              ? <XCircle className="h-3.5 w-3.5 text-red-500" />
              : <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-inherit">
          {/* Arguments */}
          {Object.keys(block.arguments).length > 0 && (
            <div className="px-3 py-2">
              <div className="text-[10px] font-medium text-muted-foreground uppercase mb-1">
                {t("contentBlocks.arguments")}
              </div>
              <pre className="text-xs font-mono bg-black/5 dark:bg-white/10 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto w-full max-w-full whitespace-pre-wrap break-all">
                {JSON.stringify(block.arguments, null, 2)}
              </pre>
            </div>
          )}
          {/* Result */}
          {hasResult && (
            <div className="px-3 py-2 border-t border-inherit">
              <div className={cn(
                "text-[10px] font-medium uppercase mb-1 flex items-center gap-1",
                isError ? "text-red-500" : "text-green-600 dark:text-green-400"
              )}>
                {isError
                  ? <><AlertTriangle className="h-3 w-3" />{t("contentBlocks.toolError")}</>
                  : <><CheckCircle2 className="h-3 w-3" />{t("contentBlocks.toolResult")}</>}
              </div>
              <div className="text-xs max-h-48 overflow-y-auto">
                {resultText ? (
                  <BlockMarkdown content={resultText} />
                ) : (
                  <pre className="font-mono bg-black/5 dark:bg-white/10 rounded p-2 overflow-x-auto w-full max-w-full whitespace-pre-wrap break-all">
                    {JSON.stringify(block.result!.content, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── 从 toolResult content 中提取文本 ──────────────────────────────── */

function extractResultText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object") {
          const rec = part as Record<string, unknown>
          if (rec.type === "text" && typeof rec.text === "string") return rec.text
        }
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

/* ── 主渲染器：ContentBlockRenderer ─────────────────────────────────── */

interface ContentBlockRendererProps {
  blocks: ContentBlock[]
  /** 用于非结构化块的纯文本回退渲染 */
  renderMarkdown: (content: string) => React.ReactNode
}

export function ContentBlockRenderer({ blocks, renderMarkdown }: ContentBlockRendererProps) {
  return (
    <div className="space-y-0.5">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "text":
            return <div key={i}>{renderMarkdown(block.text)}</div>
          case "thinking":
            return <ThinkingCard key={i} block={block} />
          case "toolCall":
            return <ToolCallCard key={i} block={block} />
          case "toolResult":
            // Standalone toolResult (not merged into toolCall) — rare
            return (
              <div key={i} className="rounded-md border border-muted bg-muted/30 px-2.5 py-1.5 text-xs my-1">
                <span className="font-medium">{block.toolName}</span>
                {block.isError && <span className="text-red-500 ml-1">(error)</span>}
              </div>
            )
          default:
            return null
        }
      })}
    </div>
  )
}
