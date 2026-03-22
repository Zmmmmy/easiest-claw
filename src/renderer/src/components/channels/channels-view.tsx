import type { CSSProperties, ReactNode } from "react"
import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp, CircleHelp, Code2, Eye, EyeOff, Loader2, Plus, Radio, RefreshCw, Save, Send, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useI18n, type Translate } from "@/i18n"

// ── Types ────────────────────────────────────────────────────────────────────

type ChannelId = "feishu" | "telegram"

interface ChannelMeta {
  id: ChannelId
  icon: ReactNode
  nameKey: string
  descKey: string
}

type FeishuAccountDraft = {
  id: string
  enabled: boolean
  appId: string
  appSecret: string
  botName: string
  domain: string
}

type TelegramAccountDraft = {
  id: string
  enabled: boolean
  name: string
  botToken: string
  tokenFile: string
}

type BindingPeerKind = "any" | "dm" | "group"

type BindingDraft = {
  agentId: string
  accountId: string
  peerKind: BindingPeerKind
  peerId: string
}

type GroupRuleDraft = {
  scopeId: string
  requireMention: boolean
}

/** Feishu / Lark official logo */
const FeishuIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1224 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M1224.146926 401.768509a50.444385 50.444385 0 0 0-23.813954-38.631991c-6.095363-3.741292-61.752335-36.782364-141.475481-43.949671a317.253146 317.253146 0 0 0-135.884563 16.982943L746.964061 25.579507A50.444385 50.444385 0 0 0 703.077446 0h-418.268027A50.444385 50.444385 0 0 0 248.027055 84.97777c3.236848 3.447033 296.360763 315.739814 426.969683 459.653442-59.734559 55.762064-103.558119 83.800735-127.666331 96.832201l-200.894764-140.823909a50.045034 50.045034 0 0 0-6.97814-4.098606L79.416697 314.205464A50.444385 50.444385 0 0 0 0.744475 364.124387c0.210185 1.177036 20.619142 118.607361 42.036988 237.635091C86.815207 847.297523 91.775572 859.656397 95.054457 867.874628c5.065457 12.611096 14.334613 24.549601 44.895503 44.538188a595.916337 595.916337 0 0 0 69.361029 38.337733c49.519571 23.603769 128.212812 54.437899 221.59798 67.25918a623.009175 623.009175 0 0 0 85.061845 5.948234c131.491697 0 290.055215-44.138837 418.373119-211.404011 73.564728-96.054517 118.250046-163.944252 154.086578-218.592335 44.033745-67.070014 70.622139-107.551633 118.838564-150.177139a50.444385 50.444385 0 0 0 16.877851-42.015969zM673.693591 100.88877L834.443032 384.638437a413.097477 413.097477 0 0 0-63.055481 59.356226c-8.743693 10.04684-17.256183 19.568218-25.579507 28.711263C656.248242 373.961042 497.033151 203.332909 401.188819 100.88877zM305.491617 882.125167c-59.86067-22.594881-102.065806-47.85911-118.523287-59.692523-10.299062-45.610132-39.935138-209.638457-65.829922-355.780044l391.238243 274.270325a48.132351 48.132351 0 0 0 6.725918 3.951477l189.166445 132.689752a398.300458 398.300458 0 0 1-155.410744 44.138837c-97.336645 7.713787-188.262649-17.277202-247.366653-39.577824z m698.654734-343.442189c-34.932737 53.197808-78.398982 119.385045-149.819824 212.496972a503.371908 503.371908 0 0 1-58.641598 64.33761l-158.185184-110.830518c35.31107-23.813953 81.152405-60.070855 135.905581-114.803013a48.342536 48.342536 0 0 0 14.944149-15.154334c18.790533-19.379051 38.568936-40.859952 59.272153-64.694924 57.086229-65.745849 124.009113-96.243683 198.540692-90.673782a247.639894 247.639894 0 0 1 38.589955 6.011289c-28.290893 33.62959-51.936698 69.63427-80.605924 113.3107z" />
  </svg>
)

const CHANNELS: ChannelMeta[] = [
  { id: "feishu", icon: <FeishuIcon className="h-5 w-5" />, nameKey: "channels.feishu.name", descKey: "channels.feishu.desc" },
  { id: "telegram", icon: <Send className="h-5 w-5" />, nameKey: "channels.telegram.name", descKey: "channels.telegram.desc" },
]

type FeishuConfig = {
  enabled?: boolean
  domain?: string
  connectionMode?: string
  defaultAccount?: string
  dmPolicy?: string
  groupPolicy?: string
  allowFrom?: string[]
  groupAllowFrom?: string[]
  groups?: Record<string, unknown>
  verificationToken?: string
  encryptKey?: string
  webhookPath?: string
  webhookHost?: string
  webhookPort?: number
  streaming?: boolean
  blockStreaming?: boolean
  typingIndicator?: boolean
  resolveSenderNames?: boolean
  allowFromInput?: string
  groupAllowFromInput?: string
  groupsInput?: string
  useAdvancedGroups?: boolean
  groupsDraft?: GroupRuleDraft[]
  accountsInput?: string
  bindingsInput?: string
  useAdvancedAccounts?: boolean
  useAdvancedBindings?: boolean
  accountsDraft?: FeishuAccountDraft[]
  bindingsDraft?: BindingDraft[]
  accounts?: Record<string, unknown>
  webhookPortInput?: string
}

type TelegramConfig = {
  enabled?: boolean
  botToken?: string
  tokenFile?: string
  defaultAccount?: string
  dmPolicy?: string
  groupPolicy?: string
  allowFrom?: string[]
  groupAllowFrom?: string[]
  groups?: Record<string, unknown>
  streamMode?: string
  blockStreaming?: boolean
  webhookUrl?: string
  webhookSecret?: string
  webhookPath?: string
  allowFromInput?: string
  groupAllowFromInput?: string
  groupsInput?: string
  useAdvancedGroups?: boolean
  groupsDraft?: GroupRuleDraft[]
  accountsInput?: string
  bindingsInput?: string
  useAdvancedAccounts?: boolean
  useAdvancedBindings?: boolean
  accountsDraft?: TelegramAccountDraft[]
  bindingsDraft?: BindingDraft[]
  accounts?: Record<string, unknown>
}

type ChannelStatusAccount = {
  accountId?: string
  enabled?: boolean
  configured?: boolean
  running?: boolean
  connected?: boolean
  lastError?: string
  lastInboundAt?: number
  lastOutboundAt?: number
  probe?: { ok?: boolean }
}

type ChannelStatusPayload = {
  channelAccounts?: Record<string, ChannelStatusAccount[]>
}

const splitList = (raw: string): string[] =>
  raw
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const joinList = (value: unknown): string => {
  if (!Array.isArray(value)) return ""
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n")
}

const joinObject = (value: unknown): string => {
  if (!isRecord(value)) return ""
  return JSON.stringify(value, null, 2)
}

const joinArray = (value: unknown): string => {
  if (!Array.isArray(value)) return ""
  return JSON.stringify(value, null, 2)
}

const parseObjectInput = (raw: string): { value?: Record<string, unknown>; error?: string } => {
  const trimmed = raw.trim()
  if (!trimmed) return { value: undefined }
  try {
    const parsed = JSON.parse(trimmed)
    if (!isRecord(parsed)) return { error: "需要是 JSON 对象（例如 {\"*\": {\"requireMention\": true}}）" }
    return { value: parsed }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const parseArrayInput = (raw: string): { value?: Record<string, unknown>[]; error?: string } => {
  const trimmed = raw.trim()
  if (!trimmed) return { value: undefined }
  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) return { error: "需要是 JSON 数组（例如 [{\"agentId\":\"main\",\"match\":{\"channel\":\"feishu\"}}]）" }
    const normalized: Record<string, unknown>[] = []
    for (const item of parsed) {
      if (!isRecord(item)) return { error: "数组中的每一项都必须是 JSON 对象" }
      normalized.push(item)
    }
    return { value: normalized }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const isBindingForChannel = (binding: unknown, channelId: ChannelId): boolean => {
  if (!isRecord(binding)) return false
  const match = binding.match
  if (!isRecord(match)) return false
  return match.channel === channelId
}

const normalizeBindingsForChannel = (
  channelId: ChannelId,
  bindings: Record<string, unknown>[],
): { value?: Record<string, unknown>[]; error?: string } => {
  const normalized: Record<string, unknown>[] = []
  for (const binding of bindings) {
    const match = isRecord(binding.match) ? { ...binding.match } : {}
    const rawChannel = typeof match.channel === "string" ? match.channel : channelId
    if (rawChannel !== channelId) {
      return { error: `存在非 ${channelId} 的路由条目：${rawChannel}` }
    }
    normalized.push({
      ...binding,
      match: {
        ...match,
        channel: channelId,
      },
    })
  }
  return { value: normalized }
}

const FEISHU_ACCOUNT_ALLOWED_KEYS = new Set(["appId", "appSecret", "botName", "domain", "enabled"])
const TELEGRAM_ACCOUNT_ALLOWED_KEYS = new Set(["name", "botToken", "tokenFile", "enabled"])
const GROUP_RULE_ALLOWED_KEYS = new Set(["requireMention"])
const BINDING_ALLOWED_KEYS = new Set(["agentId", "match"])
const BINDING_MATCH_ALLOWED_KEYS = new Set(["channel", "accountId", "peer"])
const BINDING_PEER_ALLOWED_KEYS = new Set(["kind", "id"])

const createNextAccountId = (prefix: string, existingIds: string[]): string => {
  const taken = new Set(existingIds.map((id) => id.trim()).filter(Boolean))
  for (let i = 1; i <= 9999; i += 1) {
    const candidate = `${prefix}${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${prefix}${Date.now()}`
}

const parseFeishuAccountDrafts = (value: unknown): { drafts: FeishuAccountDraft[]; simple: boolean } => {
  if (!isRecord(value)) return { drafts: [], simple: true }
  let simple = true
  const drafts: FeishuAccountDraft[] = []
  for (const [id, account] of Object.entries(value)) {
    if (!isRecord(account)) {
      simple = false
      continue
    }
    if (Object.keys(account).some((key) => !FEISHU_ACCOUNT_ALLOWED_KEYS.has(key))) simple = false
    drafts.push({
      id,
      enabled: account.enabled !== false,
      appId: typeof account.appId === "string" ? account.appId : "",
      appSecret: typeof account.appSecret === "string" ? account.appSecret : "",
      botName: typeof account.botName === "string" ? account.botName : "",
      domain: typeof account.domain === "string" ? account.domain : "",
    })
  }
  return { drafts, simple }
}

const parseTelegramAccountDrafts = (value: unknown): { drafts: TelegramAccountDraft[]; simple: boolean } => {
  if (!isRecord(value)) return { drafts: [], simple: true }
  let simple = true
  const drafts: TelegramAccountDraft[] = []
  for (const [id, account] of Object.entries(value)) {
    if (!isRecord(account)) {
      simple = false
      continue
    }
    if (Object.keys(account).some((key) => !TELEGRAM_ACCOUNT_ALLOWED_KEYS.has(key))) simple = false
    drafts.push({
      id,
      enabled: account.enabled !== false,
      name: typeof account.name === "string" ? account.name : "",
      botToken: typeof account.botToken === "string" ? account.botToken : "",
      tokenFile: typeof account.tokenFile === "string" ? account.tokenFile : "",
    })
  }
  return { drafts, simple }
}

const feishuDraftsToAccounts = (drafts: FeishuAccountDraft[]): { value?: Record<string, unknown>; error?: string } => {
  const next: Record<string, unknown> = {}
  const used = new Set<string>()
  for (const draft of drafts) {
    const id = draft.id.trim()
    if (!id) return { error: "存在空的账号 ID，请先填写" }
    if (used.has(id)) return { error: `账号 ID 重复：${id}` }
    used.add(id)
    const appId = draft.appId.trim()
    const appSecret = draft.appSecret.trim()
    if (!appId || !appSecret) return { error: `账号 ${id} 缺少 appId 或 appSecret` }
    next[id] = {
      appId,
      appSecret,
      ...(draft.botName.trim() ? { botName: draft.botName.trim() } : {}),
      ...(draft.domain.trim() ? { domain: draft.domain.trim() } : {}),
      ...(draft.enabled ? {} : { enabled: false }),
    }
  }
  return { value: next }
}

const telegramDraftsToAccounts = (drafts: TelegramAccountDraft[]): { value?: Record<string, unknown>; error?: string } => {
  const next: Record<string, unknown> = {}
  const used = new Set<string>()
  for (const draft of drafts) {
    const id = draft.id.trim()
    if (!id) return { error: "存在空的账号 ID，请先填写" }
    if (used.has(id)) return { error: `账号 ID 重复：${id}` }
    used.add(id)
    const botToken = draft.botToken.trim()
    const tokenFile = draft.tokenFile.trim()
    if (!botToken && !tokenFile) return { error: `账号 ${id} 需要 botToken 或 tokenFile` }
    next[id] = {
      ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
      ...(botToken ? { botToken } : {}),
      ...(tokenFile ? { tokenFile } : {}),
      ...(draft.enabled ? {} : { enabled: false }),
    }
  }
  return { value: next }
}

const parseGroupRuleDrafts = (value: unknown): { drafts: GroupRuleDraft[]; simple: boolean } => {
  if (!isRecord(value)) return { drafts: [], simple: true }
  let simple = true
  const drafts: GroupRuleDraft[] = []
  for (const [scopeId, rule] of Object.entries(value)) {
    if (!isRecord(rule)) {
      simple = false
      continue
    }
    if (Object.keys(rule).some((key) => !GROUP_RULE_ALLOWED_KEYS.has(key))) simple = false
    drafts.push({
      scopeId,
      requireMention: rule.requireMention === true,
    })
  }
  return { drafts, simple }
}

const groupRuleDraftsToGroups = (drafts: GroupRuleDraft[]): { value?: Record<string, unknown>; error?: string } => {
  if (drafts.length === 0) return { value: undefined }
  const groups: Record<string, unknown> = {}
  const used = new Set<string>()
  for (const draft of drafts) {
    const scopeId = draft.scopeId.trim()
    if (!scopeId) return { error: "存在空的群组范围，请先填写 scopeId（例如 * 或群ID）" }
    if (used.has(scopeId)) return { error: `群组范围重复：${scopeId}` }
    used.add(scopeId)
    groups[scopeId] = {
      requireMention: draft.requireMention,
    }
  }
  return { value: groups }
}

const parseBindingDrafts = (channelId: ChannelId, bindings: Record<string, unknown>[]): { drafts: BindingDraft[]; simple: boolean } => {
  let simple = true
  const drafts: BindingDraft[] = []
  for (const binding of bindings) {
    if (!isRecord(binding)) {
      simple = false
      continue
    }
    if (Object.keys(binding).some((key) => !BINDING_ALLOWED_KEYS.has(key))) simple = false
    const match = isRecord(binding.match) ? binding.match : null
    if (!match) {
      simple = false
      continue
    }
    if (Object.keys(match).some((key) => !BINDING_MATCH_ALLOWED_KEYS.has(key))) simple = false
    const matchChannel = typeof match.channel === "string" ? match.channel : channelId
    if (matchChannel !== channelId) {
      simple = false
      continue
    }
    let peerKind: BindingPeerKind = "any"
    let peerId = ""
    if (match.peer !== undefined) {
      if (!isRecord(match.peer)) {
        simple = false
      } else {
        if (Object.keys(match.peer).some((key) => !BINDING_PEER_ALLOWED_KEYS.has(key))) simple = false
        const kind = typeof match.peer.kind === "string" ? match.peer.kind : ""
        if (kind === "dm" || kind === "group") {
          peerKind = kind
          peerId = typeof match.peer.id === "string" ? match.peer.id : ""
        } else {
          simple = false
        }
      }
    }
    drafts.push({
      agentId: typeof binding.agentId === "string" ? binding.agentId : "",
      accountId: typeof match.accountId === "string" ? match.accountId : "",
      peerKind,
      peerId,
    })
  }
  return { drafts, simple }
}

const bindingDraftsToBindings = (
  channelId: ChannelId,
  drafts: BindingDraft[],
): { value?: Record<string, unknown>[]; error?: string } => {
  const normalized: Record<string, unknown>[] = []
  for (let idx = 0; idx < drafts.length; idx += 1) {
    const draft = drafts[idx]
    const agentId = draft.agentId.trim()
    if (!agentId) return { error: `第 ${idx + 1} 条规则缺少 agentId` }
    if ((draft.peerKind === "dm" || draft.peerKind === "group") && !draft.peerId.trim()) {
      return { error: `第 ${idx + 1} 条规则缺少 peer.id` }
    }
    const match: Record<string, unknown> = { channel: channelId }
    if (draft.accountId.trim()) match.accountId = draft.accountId.trim()
    if (draft.peerKind === "dm" || draft.peerKind === "group") {
      match.peer = { kind: draft.peerKind, id: draft.peerId.trim() }
    }
    normalized.push({ agentId, match })
  }
  return { value: normalized }
}

const pickChannelStatus = (payload: ChannelStatusPayload | null, channelId: ChannelId): ChannelStatusAccount | null => {
  const list = payload?.channelAccounts?.[channelId]
  if (!Array.isArray(list) || list.length === 0) return null
  const main = list.find((item) => item.accountId === "main" || item.accountId === "default")
  return main ?? list[0] ?? null
}

const formatAgo = (timestamp?: number): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return "-"
  const diff = Date.now() - timestamp
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// ── Main View ────────────────────────────────────────────────────────────────

export function ChannelsView() {
  const { t } = useI18n()
  const [selected, setSelected] = useState<ChannelId>("feishu")
  const [allChannels, setAllChannels] = useState<Record<string, Record<string, unknown>>>({})
  const [allBindings, setAllBindings] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusUpdatedAt, setStatusUpdatedAt] = useState<number | null>(null)
  const [statusByChannel, setStatusByChannel] = useState<Partial<Record<ChannelId, ChannelStatusAccount | null>>>({})

  // Local form state
  const [feishuForm, setFeishuForm] = useState<FeishuConfig>({})
  const [telegramForm, setTelegramForm] = useState<TelegramConfig>({})

  const refreshStatus = async (probe: boolean) => {
    setStatusLoading(true)
    try {
      const res = await window.ipc.channelsStatus({ probe, timeoutMs: probe ? 12000 : 6000 })
      const r = res as { ok: boolean; payload?: ChannelStatusPayload; error?: string }
      if (!r.ok) {
        toast.error(r.error ?? "渠道状态获取失败")
        return
      }
      const payload = r.payload ?? null
      setStatusByChannel({
        feishu: pickChannelStatus(payload, "feishu"),
        telegram: pickChannelStatus(payload, "telegram"),
      })
      setStatusUpdatedAt(Date.now())
    } catch {
      toast.error("渠道状态获取失败")
    } finally {
      setStatusLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    Promise.all([window.ipc.channelsGet(), window.ipc.bindingsGet()])
      .then(([channelsRes, bindingsRes]) => {
        if (cancelled) return

        const c = channelsRes as { ok: boolean; channels?: Record<string, Record<string, unknown>>; error?: string }
        const b = bindingsRes as { ok: boolean; bindings?: unknown[]; error?: string }
        if (!c.ok) {
          toast.error(c.error ?? t("channels.loadFailed"))
          return
        }

        const channels = c.channels ?? {}
        const bindings = Array.isArray(b.bindings)
          ? b.bindings.filter((item): item is Record<string, unknown> => isRecord(item))
          : []
        setAllChannels(channels)
        setAllBindings(bindings)

        const feishuBindings = bindings.filter((item) => isBindingForChannel(item, "feishu"))
        const telegramBindings = bindings.filter((item) => isBindingForChannel(item, "telegram"))

        // Populate feishu form
        const fs = (channels.feishu ?? {}) as FeishuConfig
        const fsAccounts = isRecord(fs.accounts) ? fs.accounts : {}
        const fsDefaultAccount =
          typeof fs.defaultAccount === "string" && fs.defaultAccount.trim()
            ? fs.defaultAccount.trim()
            : (isRecord(fsAccounts.main) ? "main" : "default")
        const parsedFeishuAccounts = parseFeishuAccountDrafts(fs.accounts)
        const feishuDrafts = parsedFeishuAccounts.drafts.length > 0
          ? parsedFeishuAccounts.drafts
          : [{
              id: fsDefaultAccount || "main",
              enabled: true,
              appId: "",
              appSecret: "",
              botName: "",
              domain: "",
            }]
        const parsedFeishuBindings = parseBindingDrafts("feishu", feishuBindings)
        const parsedFeishuGroups = parseGroupRuleDrafts(fs.groups)

        setFeishuForm({
          enabled: fs.enabled !== false,
          domain: fs.domain ?? "feishu",
          connectionMode: fs.connectionMode ?? "websocket",
          defaultAccount: fsDefaultAccount,
          dmPolicy: fs.dmPolicy ?? "pairing",
          groupPolicy: fs.groupPolicy ?? "open",
          allowFromInput: joinList(fs.allowFrom),
          groupAllowFromInput: joinList(fs.groupAllowFrom),
          groupsInput: joinObject(fs.groups),
          useAdvancedGroups: !parsedFeishuGroups.simple,
          groupsDraft: parsedFeishuGroups.drafts,
          accountsInput: joinObject(fs.accounts),
          bindingsInput: joinArray(feishuBindings),
          useAdvancedAccounts: !parsedFeishuAccounts.simple,
          useAdvancedBindings: !parsedFeishuBindings.simple,
          accountsDraft: feishuDrafts,
          bindingsDraft: parsedFeishuBindings.drafts,
          verificationToken: fs.verificationToken ?? "",
          encryptKey: fs.encryptKey ?? "",
          webhookPath: typeof fs.webhookPath === "string" ? fs.webhookPath : "",
          webhookHost: typeof fs.webhookHost === "string" ? fs.webhookHost : "",
          webhookPortInput: typeof fs.webhookPort === "number" ? String(fs.webhookPort) : "",
          streaming: fs.streaming !== false,
          blockStreaming: fs.blockStreaming !== false,
          typingIndicator: fs.typingIndicator !== false,
          resolveSenderNames: fs.resolveSenderNames !== false,
        })

        // Populate telegram form
        const tg = (channels.telegram ?? {}) as TelegramConfig
        const tgAccounts = isRecord(tg.accounts) ? tg.accounts : {}
        const tgDefaultAccount =
          typeof tg.defaultAccount === "string" && tg.defaultAccount.trim()
            ? tg.defaultAccount.trim()
            : (isRecord(tgAccounts.default) ? "default" : "main")
        const parsedTelegramAccounts = parseTelegramAccountDrafts(tg.accounts)
        const telegramDrafts = parsedTelegramAccounts.drafts.length > 0
          ? parsedTelegramAccounts.drafts
          : [{
              id: tgDefaultAccount || "default",
              enabled: true,
              name: "",
              botToken: typeof tg.botToken === "string" ? tg.botToken : "",
              tokenFile: typeof tg.tokenFile === "string" ? tg.tokenFile : "",
            }]
        const parsedTelegramBindings = parseBindingDrafts("telegram", telegramBindings)
        const parsedTelegramGroups = parseGroupRuleDrafts(tg.groups)

        setTelegramForm({
          enabled: tg.enabled !== false,
          botToken: tg.botToken ?? "",
          tokenFile: tg.tokenFile ?? "",
          defaultAccount: tgDefaultAccount,
          dmPolicy: tg.dmPolicy ?? "pairing",
          groupPolicy: tg.groupPolicy ?? "allowlist",
          streamMode:
            tg.streamMode ??
            (typeof (channels.telegram as Record<string, unknown>)?.streaming === "string"
              ? String((channels.telegram as Record<string, unknown>).streaming)
              : "partial"),
          blockStreaming: tg.blockStreaming === true,
          webhookUrl: tg.webhookUrl ?? "",
          webhookSecret: tg.webhookSecret ?? "",
          webhookPath: tg.webhookPath ?? "",
          allowFromInput: joinList(tg.allowFrom),
          groupAllowFromInput: joinList(tg.groupAllowFrom),
          groupsInput: joinObject(tg.groups),
          useAdvancedGroups: !parsedTelegramGroups.simple,
          groupsDraft: parsedTelegramGroups.drafts,
          accountsInput: joinObject(tg.accounts),
          bindingsInput: joinArray(telegramBindings),
          useAdvancedAccounts: !parsedTelegramAccounts.simple,
          useAdvancedBindings: !parsedTelegramBindings.simple,
          accountsDraft: telegramDrafts,
          bindingsDraft: parsedTelegramBindings.drafts,
        })

        if (!b.ok && b.error) {
          toast.error(`多 Agent 路由读取失败：${b.error}`)
        }
      })
      .catch(() => {
        if (!cancelled) toast.error(t("channels.loadFailed"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void refreshStatus(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const useAdvancedBindings = selected === "feishu"
        ? feishuForm.useAdvancedBindings === true
        : telegramForm.useAdvancedBindings === true
      let normalizedBindings: { value?: Record<string, unknown>[]; error?: string }
      if (useAdvancedBindings) {
        const rawBindingsInput = selected === "feishu" ? (feishuForm.bindingsInput ?? "") : (telegramForm.bindingsInput ?? "")
        const bindingsParsed = parseArrayInput(rawBindingsInput)
        if (bindingsParsed.error) {
          toast.error(`多 Agent 路由配置无效：${bindingsParsed.error}`)
          return
        }
        normalizedBindings = normalizeBindingsForChannel(selected, bindingsParsed.value ?? [])
      } else {
        const bindingDrafts = selected === "feishu" ? (feishuForm.bindingsDraft ?? []) : (telegramForm.bindingsDraft ?? [])
        normalizedBindings = bindingDraftsToBindings(selected, bindingDrafts)
        if (!normalizedBindings.error) {
          if (selected === "feishu") {
            setFeishuForm((prev) => ({ ...prev, bindingsInput: joinArray(normalizedBindings.value ?? []) }))
          } else {
            setTelegramForm((prev) => ({ ...prev, bindingsInput: joinArray(normalizedBindings.value ?? []) }))
          }
        }
      }
      if (normalizedBindings.error) {
        toast.error(`多 Agent 路由配置无效：${normalizedBindings.error}`)
        return
      }
      const nextBindings = [
        ...allBindings.filter((item) => !isBindingForChannel(item, selected)),
        ...(normalizedBindings.value ?? []),
      ]

      // Build the config for the selected channel
      let config: Record<string, unknown>
      if (selected === "feishu") {
        const useAdvancedAccounts = feishuForm.useAdvancedAccounts === true
        let accounts: Record<string, unknown> | undefined
        if (useAdvancedAccounts) {
          const accountsParsed = parseObjectInput(feishuForm.accountsInput ?? "")
          if (accountsParsed.error) {
            toast.error(`飞书 accounts 配置无效：${accountsParsed.error}`)
            return
          }
          accounts = accountsParsed.value
        } else {
          const accountsParsed = feishuDraftsToAccounts(feishuForm.accountsDraft ?? [])
          if (accountsParsed.error) {
            toast.error(`飞书账号配置无效：${accountsParsed.error}`)
            return
          }
          accounts = accountsParsed.value
          setFeishuForm((prev) => ({ ...prev, accountsInput: joinObject(accounts ?? {}) }))
        }

        const accountIds = Object.keys(accounts ?? {})
        if (accountIds.length === 0) {
          toast.error("请至少配置一个飞书账号")
          return
        }
        const defaultAccount = feishuForm.defaultAccount?.trim() || accountIds[0]
        if (!defaultAccount || !isRecord(accounts?.[defaultAccount])) {
          toast.error(`defaultAccount=${defaultAccount} 在 accounts 中不存在`)
          return
        }

        const allowFrom = splitList(feishuForm.allowFromInput ?? "")
        const groupAllowFrom = splitList(feishuForm.groupAllowFromInput ?? "")
        let groupsValue: Record<string, unknown> | undefined
        if (feishuForm.useAdvancedGroups === true) {
          const groupsParsed = parseObjectInput(feishuForm.groupsInput ?? "")
          if (groupsParsed.error) {
            toast.error(`飞书 groups 配置无效：${groupsParsed.error}`)
            return
          }
          groupsValue = groupsParsed.value
        } else {
          const groupsParsed = groupRuleDraftsToGroups(feishuForm.groupsDraft ?? [])
          if (groupsParsed.error) {
            toast.error(`飞书群组配置无效：${groupsParsed.error}`)
            return
          }
          groupsValue = groupsParsed.value
          setFeishuForm((prev) => ({ ...prev, groupsInput: joinObject(groupsValue ?? {}) }))
        }
        const webhookPortRaw = feishuForm.webhookPortInput?.trim() ?? ""
        let webhookPort: number | undefined
        if (webhookPortRaw) {
          webhookPort = Number(webhookPortRaw)
          if (!Number.isInteger(webhookPort) || webhookPort <= 0 || webhookPort > 65535) {
            toast.error("Webhook 端口必须是 1-65535 的整数")
            return
          }
        }

        if (feishuForm.dmPolicy === "allowlist" && allowFrom.length === 0) {
          toast.error("飞书私聊白名单为空，请补充 allowFrom")
          return
        }
        if (feishuForm.dmPolicy === "open" && !allowFrom.includes("*")) {
          toast.error("飞书私聊策略为 open 时，allowFrom 至少包含 *")
          return
        }
        if (feishuForm.groupPolicy === "allowlist" && groupAllowFrom.length === 0) {
          toast.error("飞书群聊白名单为空，请补充 groupAllowFrom")
          return
        }

        const mode = feishuForm.connectionMode ?? "websocket"
        if (mode === "webhook") {
          if (!feishuForm.verificationToken?.trim()) {
            toast.error("Webhook 模式缺少 Verification Token")
            return
          }
          if (!feishuForm.encryptKey?.trim()) {
            toast.error("Webhook 模式缺少 Encrypt Key")
            return
          }
        }

        const existing = (allChannels.feishu ?? {}) as Record<string, unknown>
        config = {
          ...existing,
          enabled: feishuForm.enabled !== false,
          domain: feishuForm.domain ?? "feishu",
          connectionMode: mode,
          defaultAccount,
          dmPolicy: feishuForm.dmPolicy ?? "pairing",
          groupPolicy: feishuForm.groupPolicy ?? "open",
          allowFrom: allowFrom.length > 0 ? allowFrom : undefined,
          groupAllowFrom: groupAllowFrom.length > 0 ? groupAllowFrom : undefined,
          groups: groupsValue,
          verificationToken: feishuForm.verificationToken?.trim() || undefined,
          encryptKey: feishuForm.encryptKey?.trim() || undefined,
          webhookPath: feishuForm.webhookPath?.trim() || undefined,
          webhookHost: feishuForm.webhookHost?.trim() || undefined,
          webhookPort,
          streaming: feishuForm.streaming !== false,
          blockStreaming: feishuForm.blockStreaming !== false,
          typingIndicator: feishuForm.typingIndicator !== false,
          resolveSenderNames: feishuForm.resolveSenderNames !== false,
          accounts,
        }
      } else {
        const useAdvancedAccounts = telegramForm.useAdvancedAccounts === true
        let accounts: Record<string, unknown> | undefined
        if (useAdvancedAccounts) {
          const accountsParsed = parseObjectInput(telegramForm.accountsInput ?? "")
          if (accountsParsed.error) {
            toast.error(`Telegram accounts 配置无效：${accountsParsed.error}`)
            return
          }
          accounts = accountsParsed.value
        } else {
          const accountsParsed = telegramDraftsToAccounts(telegramForm.accountsDraft ?? [])
          if (accountsParsed.error) {
            toast.error(`Telegram 账号配置无效：${accountsParsed.error}`)
            return
          }
          accounts = accountsParsed.value
          setTelegramForm((prev) => ({ ...prev, accountsInput: joinObject(accounts ?? {}) }))
        }

        const accountIds = Object.keys(accounts ?? {})
        if (accountIds.length === 0) {
          toast.error("请至少配置一个 Telegram 账号")
          return
        }
        const defaultAccount = telegramForm.defaultAccount?.trim() || accountIds[0]
        if (!defaultAccount || !isRecord(accounts?.[defaultAccount])) {
          toast.error(`defaultAccount=${defaultAccount} 在 accounts 中不存在`)
          return
        }

        const allowFrom = splitList(telegramForm.allowFromInput ?? "")
        const groupAllowFrom = splitList(telegramForm.groupAllowFromInput ?? "")
        let groupsValue: Record<string, unknown> | undefined
        if (telegramForm.useAdvancedGroups === true) {
          const groupsParsed = parseObjectInput(telegramForm.groupsInput ?? "")
          if (groupsParsed.error) {
            toast.error(`Telegram groups 配置无效：${groupsParsed.error}`)
            return
          }
          groupsValue = groupsParsed.value
        } else {
          const groupsParsed = groupRuleDraftsToGroups(telegramForm.groupsDraft ?? [])
          if (groupsParsed.error) {
            toast.error(`Telegram 群组配置无效：${groupsParsed.error}`)
            return
          }
          groupsValue = groupsParsed.value
          setTelegramForm((prev) => ({ ...prev, groupsInput: joinObject(groupsValue ?? {}) }))
        }
        if (telegramForm.dmPolicy === "allowlist" && allowFrom.length === 0) {
          toast.error("Telegram 私聊白名单为空，请补充 allowFrom")
          return
        }
        if (telegramForm.dmPolicy === "open" && !allowFrom.includes("*")) {
          toast.error("Telegram 私聊策略为 open 时，allowFrom 至少包含 *")
          return
        }
        if (telegramForm.groupPolicy === "allowlist" && groupAllowFrom.length === 0) {
          toast.error("Telegram 群聊白名单为空，请补充 groupAllowFrom")
          return
        }
        if (telegramForm.webhookUrl?.trim() && !telegramForm.webhookSecret?.trim()) {
          toast.error("启用 Telegram webhookUrl 时，必须填写 webhookSecret")
          return
        }
        const existing = (allChannels.telegram ?? {}) as Record<string, unknown>
        const defaultAccountConfig = isRecord(accounts?.[defaultAccount]) ? accounts?.[defaultAccount] : {}
        const token = isRecord(defaultAccountConfig) && typeof defaultAccountConfig.botToken === "string"
          ? defaultAccountConfig.botToken.trim()
          : ""
        const tokenFile = isRecord(defaultAccountConfig) && typeof defaultAccountConfig.tokenFile === "string"
          ? defaultAccountConfig.tokenFile.trim()
          : ""
        config = {
          ...existing,
          enabled: telegramForm.enabled !== false,
          botToken: token || undefined,
          tokenFile: tokenFile || undefined,
          defaultAccount,
          dmPolicy: telegramForm.dmPolicy ?? "pairing",
          groupPolicy: telegramForm.groupPolicy ?? "allowlist",
          streamMode: telegramForm.streamMode ?? "partial",
          streaming: undefined,
          blockStreaming: telegramForm.blockStreaming === true,
          webhookUrl: telegramForm.webhookUrl?.trim() || undefined,
          webhookSecret: telegramForm.webhookSecret?.trim() || undefined,
          webhookPath: telegramForm.webhookPath?.trim() || undefined,
          allowFrom: allowFrom.length > 0 ? allowFrom : undefined,
          groupAllowFrom: groupAllowFrom.length > 0 ? groupAllowFrom : undefined,
          groups: groupsValue,
          accounts,
        }
      }

      const res = await window.ipc.channelsSet({ channelId: selected, config })
      const r = res as { ok: boolean; error?: string }
      if (!r.ok) {
        toast.error(r.error ?? t("channels.saveFailed"))
        return
      }

      const bindingsRes = await window.ipc.bindingsSet({ bindings: nextBindings })
      const b = bindingsRes as { ok: boolean; error?: string }
      if (!b.ok) {
        toast.error(`渠道配置已保存，但多 Agent 路由保存失败：${b.error ?? "未知错误"}`)
      } else {
        setAllBindings(nextBindings)
      }

      toast.success(t("channels.saveSuccess"))
      // Update local cache
      setAllChannels((prev) => ({ ...prev, [selected]: config }))
      void refreshStatus(true)
    } catch {
      toast.error(t("channels.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const isEnabled = (id: ChannelId) => {
    const runtime = statusByChannel[id]
    if (runtime?.connected === true || runtime?.running === true) return true
    const ch = allChannels[id] as { enabled?: boolean } | undefined
    return ch?.enabled === true
  }

  const isConfigured = (id: ChannelId) => {
    if (id === "feishu") {
      const fs = allChannels.feishu as FeishuConfig | undefined
      const accounts = fs?.accounts
      if (accounts && isRecord(accounts)) {
        for (const value of Object.values(accounts)) {
          if (isRecord(value) && typeof value.appId === "string" && value.appId.trim()) return true
        }
      }
      return false
    }
    const tg = allChannels.telegram as TelegramConfig | undefined
    if (tg?.botToken || tg?.tokenFile) return true
    const accounts = tg?.accounts
    if (accounts && isRecord(accounts)) {
      for (const value of Object.values(accounts)) {
        if (!isRecord(value)) continue
        if (typeof value.botToken === "string" && value.botToken.trim()) return true
        if (typeof value.tokenFile === "string" && value.tokenFile.trim()) return true
      }
    }
    return false
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-muted/10">
      {/* Page Header */}
      <div
        className="shrink-0 flex items-center gap-3 px-8 py-5 border-b bg-background"
        style={{
          WebkitAppRegion: "drag",
          ...(window.ipc.platform !== "darwin" && { paddingRight: "154px" }),
        } as CSSProperties}
      >
        <div
          className="flex items-center gap-3"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Radio className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">{t("channels.title")}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{t("channels.description")}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void refreshStatus(true)}
            disabled={statusLoading}
          >
            {statusLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            探测状态
          </Button>
          {statusUpdatedAt && (
            <span className="text-[11px] text-muted-foreground">
              {new Date(statusUpdatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">{t("channels.loading")}</span>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* Left: Channel list */}
          <div className="w-[220px] shrink-0 border-r bg-background overflow-y-auto py-3">
            {CHANNELS.map((ch) => (
              <button
                key={ch.id}
                className={cn(
                  "mx-2 w-[calc(100%-1rem)] rounded-lg flex items-center gap-2.5 px-3.5 py-3 text-left transition-colors cursor-pointer",
                  selected === ch.id ? "bg-accent shadow-sm" : "hover:bg-accent/60",
                )}
                onClick={() => setSelected(ch.id)}
              >
                <span className="text-lg shrink-0 flex items-center justify-center w-6 h-6">{ch.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{t(ch.nameKey)}</span>
                    {isConfigured(ch.id) && (
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full shrink-0",
                          isEnabled(ch.id) ? "bg-green-500" : "bg-muted-foreground/40",
                        )}
                      />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{t(ch.descKey)}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Right: Config form */}
          <div className="flex-1 overflow-y-auto px-8 py-6 md:px-10">
            <div className="mx-auto w-full max-w-5xl space-y-4">
              <ChannelStatusCard status={statusByChannel[selected] ?? null} />
              {selected === "feishu" ? (
                <FeishuConfigForm
                  value={feishuForm}
                  onChange={setFeishuForm}
                  saving={saving}
                  onSave={handleSave}
                />
              ) : (
                <TelegramConfigForm
                  value={telegramForm}
                  onChange={setTelegramForm}
                  saving={saving}
                  onSave={handleSave}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Shared form components ───────────────────────────────────────────────────

function ChannelStatusCard({ status }: { status: ChannelStatusAccount | null }) {
  const badge = (() => {
    if (!status) return { label: "未检测", className: "bg-muted text-muted-foreground border-border", detail: "尚未从网关读取状态" }
    if (status.lastError) return { label: "异常", className: "bg-red-50 text-red-700 border-red-200", detail: status.lastError }
    if (status.probe?.ok === false) return { label: "探测失败", className: "bg-red-50 text-red-700 border-red-200", detail: "探测失败，请检查网络或密钥" }
    if (status.connected === true) return { label: "已连接", className: "bg-emerald-50 text-emerald-700 border-emerald-200", detail: "渠道连接正常" }
    if (status.running === true) return { label: "运行中", className: "bg-amber-50 text-amber-700 border-amber-200", detail: "进程已启动，等待连通" }
    if (status.enabled === false) return { label: "已停用", className: "bg-muted text-muted-foreground border-border", detail: "渠道当前未启用" }
    return { label: "未连接", className: "bg-amber-50 text-amber-700 border-amber-200", detail: "请检查配置与网关状态" }
  })()

  return (
    <div className="mb-5 rounded-xl border bg-background px-4 py-3 shadow-sm sm:px-5 sm:py-4">
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium", badge.className)}>
          {badge.label}
        </span>
        {status?.accountId && <span className="text-xs text-muted-foreground">账号: {status.accountId}</span>}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{badge.detail}</p>
      <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
        <span>入站: {formatAgo(status?.lastInboundAt)}</span>
        <span>出站: {formatAgo(status?.lastOutboundAt)}</span>
      </div>
    </div>
  )
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border bg-background px-4 py-4 sm:px-5">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</h3>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {children}
    </div>
  )
}

const normalizeTipLabel = (label: string): string => label.replace(/\s*\([^)]*\)\s*/g, "").trim()
const normalizeTipKey = (label: string): string => normalizeTipLabel(label).replace(/\s+/g, " ").toLowerCase()

const TIP_KEY_BY_LABEL: Record<string, string> = {
  "dm policy": "dmPolicy",
  "group policy": "groupPolicy",
  "platform": "platform",
  "connection mode": "connectionMode",
  "app id": "appId",
  "app secret": "appSecret",
  "bot name": "botName",
  "agent id": "agentId",
  "bot token": "botToken",
  "webhook url": "webhookUrl",
  "webhook secret": "webhookSecret",
  "webhook path": "webhookPath",
  "webhook host": "webhookHost",
  "webhook port": "webhookPort",
  "verification token": "verificationToken",
  "encrypt key": "encryptKey",
}

const getLocalizedTip = (
  t: Translate,
  key: string,
): string | null => {
  const path = `channels.tips.${key}`
  const localized = t(path)
  if (!localized || localized === path) return null
  return localized
}

const resolveTipText = ({
  t,
  label,
  tip,
  tipKey,
}: {
  t: Translate
  label: string
  tip?: string
  tipKey?: string
}): string => {
  if (tip?.trim()) return tip.trim()

  if (tipKey) {
    const localized = getLocalizedTip(t, tipKey)
    if (localized) return localized
  }

  const mappedKey = TIP_KEY_BY_LABEL[normalizeTipKey(label)]
  if (mappedKey) {
    const localized = getLocalizedTip(t, mappedKey)
    if (localized) return localized
  }

  const generic = getLocalizedTip(t, "generic")
  if (generic) return generic

  const normalized = normalizeTipLabel(label)
  return normalized ? `Used to configure ${normalized}.` : "Used to configure this setting."
}
function FieldTip({ content }: { content: string }) {
  const { t } = useI18n()
  return (
    <Tooltip>
      <TooltipTrigger
        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={t("channels.tips.ariaLabel")}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] text-xs leading-relaxed">
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
function FormField({
  label,
  required,
  headerRight,
  tip,
  tipKey,
  children,
}: {
  label: string
  required?: boolean
  headerRight?: ReactNode
  tip?: string
  tipKey?: string
  children: ReactNode
}) {
  const { t } = useI18n()
  const tipText = resolveTipText({ t, label, tip, tipKey })
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-[18px] items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <label className="truncate text-xs font-medium leading-none text-muted-foreground">
            {label}{required && <span className="ml-0.5 text-destructive">*</span>}
          </label>
          <FieldTip content={tipText} />
        </div>
        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
      </div>
      {children}
    </div>
  )
}
function FormSwitchField({
  label,
  tip,
  tipKey,
  checked,
  onCheckedChange,
}: {
  label: string
  tip?: string
  tipKey?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const { t } = useI18n()
  const tipText = resolveTipText({ t, label, tip, tipKey })
  return (
    <div className="flex h-8 items-center justify-between rounded-md border bg-muted/20 px-3">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-foreground">{label}</span>
        <FieldTip content={tipText} />
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
function InlineSwitchChip({
  label,
  tip,
  tipKey,
  checked,
  onCheckedChange,
}: {
  label: string
  tip?: string
  tipKey?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const { t } = useI18n()
  const tipText = resolveTipText({ t, label, tip, tipKey })
  return (
    <div className="flex h-8 min-w-[116px] items-center justify-between gap-2 rounded-md border bg-background px-2.5">
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <FieldTip content={tipText} />
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm font-mono pr-9"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

function PolicySelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: (key: string) => string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="pairing">{t("channels.policy.pairing")}</SelectItem>
        <SelectItem value="open">{t("channels.policy.open")}</SelectItem>
        <SelectItem value="allowlist">{t("channels.policy.allowlist")}</SelectItem>
        <SelectItem value="disabled">{t("channels.policy.disabled")}</SelectItem>
      </SelectContent>
    </Select>
  )
}

function ListInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <Textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="min-h-[78px] text-xs font-mono"
    />
  )
}

function EditorModeToggle({
  checked,
  onCheckedChange,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <div className="inline-flex h-8 items-center rounded-md border bg-muted/20 px-2 gap-2">
      <Code2 className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[11px] text-muted-foreground">{t("channels.advancedJsonMode")}</span>
      <FieldTip content={resolveTipText({ t, label: t("channels.advancedJsonMode"), tipKey: "advancedJsonMode" })} />
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function FeishuAccountsEditor({
  value,
  onChange,
}: {
  value: FeishuAccountDraft[]
  onChange: (next: FeishuAccountDraft[]) => void
}) {
  const update = (idx: number, patch: Partial<FeishuAccountDraft>) => {
    onChange(value.map((item, i) => (i === idx ? { ...item, ...patch } : item)))
  }

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx))
  }

  const add = () => {
    onChange([
      ...value,
      {
        id: createNextAccountId("account", value.map((item) => item.id)),
        enabled: true,
        appId: "",
        appSecret: "",
        botName: "",
        domain: "",
      },
    ])
  }

  return (
    <div className="space-y-2">
      {value.map((account, idx) => (
        <div key={`${account.id || "empty"}-${idx}`} className="rounded-md border bg-muted/20 p-3 space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_116px_32px] sm:items-end">
            <FormField label="账号 ID" tipKey="accountId">
              <Input
                value={account.id}
                onChange={(event) => update(idx, { id: event.target.value })}
                placeholder="main"
                className="h-8 text-sm font-mono"
              />
            </FormField>
            <InlineSwitchChip
              label="启用"
              tipKey="enabledAccount"
              checked={account.enabled}
              onCheckedChange={(checked) => update(idx, { enabled: checked })}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 self-end"
              onClick={() => remove(idx)}
              aria-label="删除飞书账号"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <FormField label="App ID" tipKey="appId">
              <Input
                value={account.appId}
                onChange={(event) => update(idx, { appId: event.target.value })}
                placeholder="cli_xxx"
                className="h-8 text-sm font-mono"
              />
            </FormField>
            <FormField label="App Secret" tipKey="appSecret">
              <PasswordInput
                value={account.appSecret}
                onChange={(next) => update(idx, { appSecret: next })}
                placeholder="请填写 App Secret"
              />
            </FormField>
            <FormField label="Bot Name" tipKey="botName">
              <Input
                value={account.botName}
                onChange={(event) => update(idx, { botName: event.target.value })}
                placeholder="可选"
                className="h-8 text-sm"
              />
            </FormField>
            <FormField label="账号 Domain" tipKey="accountDomain">
              <Select
                value={account.domain || "__inherit__"}
                onValueChange={(next) => update(idx, { domain: next === "__inherit__" ? "" : next })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__inherit__">跟随渠道</SelectItem>
                  <SelectItem value="feishu">feishu</SelectItem>
                  <SelectItem value="lark">lark</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={add}>
        <Plus className="h-3.5 w-3.5" />
        添加飞书账号
      </Button>
    </div>
  )
}

function TelegramAccountsEditor({
  value,
  onChange,
}: {
  value: TelegramAccountDraft[]
  onChange: (next: TelegramAccountDraft[]) => void
}) {
  const update = (idx: number, patch: Partial<TelegramAccountDraft>) => {
    onChange(value.map((item, i) => (i === idx ? { ...item, ...patch } : item)))
  }

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx))
  }

  const add = () => {
    onChange([
      ...value,
      {
        id: createNextAccountId("account", value.map((item) => item.id)),
        enabled: true,
        name: "",
        botToken: "",
        tokenFile: "",
      },
    ])
  }

  return (
    <div className="space-y-2">
      {value.map((account, idx) => (
        <div key={`${account.id || "empty"}-${idx}`} className="rounded-md border bg-muted/20 p-3 space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_116px_32px] sm:items-end">
            <FormField label="账号 ID" tipKey="accountId">
              <Input
                value={account.id}
                onChange={(event) => update(idx, { id: event.target.value })}
                placeholder="default"
                className="h-8 text-sm font-mono"
              />
            </FormField>
            <InlineSwitchChip
              label="启用"
              tipKey="enabledAccount"
              checked={account.enabled}
              onCheckedChange={(checked) => update(idx, { enabled: checked })}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 self-end"
              onClick={() => remove(idx)}
              aria-label="删除 Telegram 账号"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <FormField label="账号名称" tipKey="accountName">
              <Input
                value={account.name}
                onChange={(event) => update(idx, { name: event.target.value })}
                placeholder="可选"
                className="h-8 text-sm"
              />
            </FormField>
            <FormField label="Token 文件路径" tipKey="tokenFile">
              <Input
                value={account.tokenFile}
                onChange={(event) => update(idx, { tokenFile: event.target.value })}
                placeholder="/path/to/telegram.token"
                className="h-8 text-sm font-mono"
              />
            </FormField>
            <FormField label="Bot Token" tipKey="botToken">
              <PasswordInput
                value={account.botToken}
                onChange={(next) => update(idx, { botToken: next })}
                placeholder="123456789:ABC..."
              />
            </FormField>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={add}>
        <Plus className="h-3.5 w-3.5" />
        添加 Telegram 账号
      </Button>
    </div>
  )
}

function GroupsEditor({
  value,
  onChange,
}: {
  value: GroupRuleDraft[]
  onChange: (next: GroupRuleDraft[]) => void
}) {
  const update = (idx: number, patch: Partial<GroupRuleDraft>) => {
    onChange(value.map((item, i) => (i === idx ? { ...item, ...patch } : item)))
  }

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx))
  }

  const add = () => {
    onChange([
      ...value,
      { scopeId: value.length === 0 ? "*" : "", requireMention: true },
    ])
  }

  return (
    <div className="space-y-2">
      {value.map((item, idx) => (
        <div key={`${item.scopeId || "scope"}-${idx}`} className="rounded-md border bg-muted/20 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_116px_32px] sm:items-end">
            <FormField label="群组范围 (scopeId)" tipKey="groupScopeId">
              <Input
                value={item.scopeId}
                onChange={(event) => update(idx, { scopeId: event.target.value })}
                placeholder="* 或具体群ID（如 oc_xxx / -100123456）"
                className="h-8 text-sm font-mono"
              />
            </FormField>
            <InlineSwitchChip
              label="需提及"
              tipKey="requireMention"
              checked={item.requireMention}
              onCheckedChange={(checked) => update(idx, { requireMention: checked })}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 self-end"
              onClick={() => remove(idx)}
              aria-label="删除群组规则"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={add}>
        <Plus className="h-3.5 w-3.5" />
        添加群组规则
      </Button>
    </div>
  )
}

function BindingsEditor({
  channelId,
  value,
  onChange,
}: {
  channelId: ChannelId
  value: BindingDraft[]
  onChange: (next: BindingDraft[]) => void
}) {
  const update = (idx: number, patch: Partial<BindingDraft>) => {
    onChange(value.map((item, i) => (i === idx ? { ...item, ...patch } : item)))
  }

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx))
  }

  const move = (idx: number, direction: -1 | 1) => {
    const next = [...value]
    const target = idx + direction
    if (target < 0 || target >= next.length) return
    const temp = next[idx]
    next[idx] = next[target]
    next[target] = temp
    onChange(next)
  }

  const add = () => {
    onChange([...value, { agentId: "", accountId: "", peerKind: "any", peerId: "" }])
  }

  return (
    <div className="space-y-2">
      {value.map((binding, idx) => (
        <div key={`binding-${idx}`} className="rounded-md border bg-muted/20 p-3 space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <FormField label="Agent ID" tipKey="agentId">
              <Input
                value={binding.agentId}
                onChange={(event) => update(idx, { agentId: event.target.value })}
                placeholder="main"
                className="h-8 text-sm font-mono"
              />
            </FormField>
            <FormField label="账号 ID (match.accountId)" tipKey="matchAccountId">
              <Input
                value={binding.accountId}
                onChange={(event) => update(idx, { accountId: event.target.value })}
                placeholder="留空表示匹配任意账号"
                className="h-8 text-sm font-mono"
              />
            </FormField>
            <FormField label="会话类型 (match.peer.kind)" tipKey="peerKind">
              <Select
                value={binding.peerKind}
                onValueChange={(next) => update(idx, { peerKind: next as BindingPeerKind })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">任意</SelectItem>
                  <SelectItem value="dm">私聊 (dm)</SelectItem>
                  <SelectItem value="group">群聊 (group)</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="会话 ID (match.peer.id)" tipKey="peerId">
              <Input
                value={binding.peerId}
                onChange={(event) => update(idx, { peerId: event.target.value })}
                placeholder={binding.peerKind === "any" ? "peer.kind=any 时可留空" : "必填"}
                className="h-8 text-sm font-mono"
                disabled={binding.peerKind === "any"}
              />
            </FormField>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-muted-foreground">
              channel 固定为 {channelId}
            </span>
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => move(idx, -1)} aria-label="上移规则">
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => move(idx, 1)} aria-label="下移规则">
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => remove(idx)} aria-label="删除路由规则">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={add}>
        <Plus className="h-3.5 w-3.5" />
        添加路由规则
      </Button>
    </div>
  )
}

// ── Feishu Config Form ───────────────────────────────────────────────────────

function FeishuConfigForm({
  value,
  onChange,
  saving,
  onSave,
}: {
  value: FeishuConfig
  onChange: (v: FeishuConfig) => void
  saving: boolean
  onSave: () => void
}) {
  const { t } = useI18n()
  const accounts = value.accountsDraft ?? []
  const groups = value.groupsDraft ?? []
  const hasConfigured = accounts.some((item) => item.appId.trim())

  const updateAccounts = (nextAccounts: FeishuAccountDraft[]) => {
    const validIds = nextAccounts.map((item) => item.id.trim()).filter(Boolean)
    let nextDefault = value.defaultAccount?.trim() ?? ""
    if (!nextDefault || !validIds.includes(nextDefault)) {
      nextDefault = validIds[0] ?? ""
    }
    onChange({
      ...value,
      accountsDraft: nextAccounts,
      defaultAccount: nextDefault,
    })
  }

  const updateGroups = (nextGroups: GroupRuleDraft[]) => {
    onChange({ ...value, groupsDraft: nextGroups })
  }

  return (
    <div className="w-full space-y-5 pb-8">
      <div className="rounded-xl border bg-background px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl"><FeishuIcon className="h-6 w-6" /></span>
            <h2 className="text-base font-semibold">{t("channels.feishu.name")}</h2>
            {hasConfigured && (
              <Badge variant={value.enabled !== false ? "default" : "secondary"} className="text-[10px] px-1.5 h-4">
                {value.enabled !== false ? t("channels.enabled") : t("channels.disabled")}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <FieldTip content={resolveTipText({ t, label: t("channels.enabled"), tipKey: "channelEnabled" })} />
            <Switch
              checked={value.enabled !== false}
              onCheckedChange={(checked) => onChange({ ...value, enabled: checked })}
            />
          </div>
        </div>
      </div>

      <FormSection title={t("channels.requiredFields")}>
        <FormField
          label="多账号配置"
          tipKey="multiAccount"
          required
          headerRight={(
            <EditorModeToggle
              checked={value.useAdvancedAccounts === true}
              onCheckedChange={(checked) => onChange({ ...value, useAdvancedAccounts: checked })}
            />
          )}
        >
          {value.useAdvancedAccounts === true ? (
            <ListInput
              value={value.accountsInput ?? ""}
              onChange={(next) => onChange({ ...value, accountsInput: next })}
              placeholder={'例如：{\n  "main": { "appId": "cli_xxx", "appSecret": "xxx" },\n  "backup": { "appId": "cli_yyy", "appSecret": "yyy", "enabled": false }\n}'}
            />
          ) : (
            <FeishuAccountsEditor value={accounts} onChange={updateAccounts} />
          )}
        </FormField>
      </FormSection>

      <p className="px-1 text-[11px] text-muted-foreground">
        {t("channels.feishu.setupHint")}
      </p>

      <FormSection title={t("channels.optionalFields")}>
        <FieldGrid>
          <FormField label={t("channels.feishu.domain")} tipKey="platform">
            <Select
              value={value.domain ?? "feishu"}
              onValueChange={(v) => onChange({ ...value, domain: v })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="feishu">{t("channels.feishu.domainFeishu")}</SelectItem>
                <SelectItem value="lark">{t("channels.feishu.domainLark")}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField label={t("channels.feishu.connectionMode")} tipKey="connectionMode">
            <Select
              value={value.connectionMode ?? "websocket"}
              onValueChange={(v) => onChange({ ...value, connectionMode: v })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="websocket">WebSocket</SelectItem>
                <SelectItem value="webhook">Webhook</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </FieldGrid>

        <FormField label="默认账户 (defaultAccount)" tipKey="defaultAccount">
          <Input
            value={value.defaultAccount ?? ""}
            onChange={(event) => onChange({ ...value, defaultAccount: event.target.value })}
            placeholder="main"
            className="h-8 text-sm font-mono"
          />
        </FormField>

        <FormField
          label="多 Agent 路由"
          tipKey="bindings"
          headerRight={(
            <EditorModeToggle
              checked={value.useAdvancedBindings === true}
              onCheckedChange={(checked) => onChange({ ...value, useAdvancedBindings: checked })}
            />
          )}
        >
          {value.useAdvancedBindings === true ? (
            <ListInput
              value={value.bindingsInput ?? ""}
              onChange={(next) => onChange({ ...value, bindingsInput: next })}
              placeholder={'例如：[\n  { "agentId": "main", "match": { "channel": "feishu", "accountId": "main" } },\n  { "agentId": "ops", "match": { "channel": "feishu", "peer": { "kind": "group", "id": "oc_xxx" } } }\n]'}
            />
          ) : (
            <BindingsEditor
              channelId="feishu"
              value={value.bindingsDraft ?? []}
              onChange={(next) => onChange({ ...value, bindingsDraft: next })}
            />
          )}
        </FormField>

        <FieldGrid>
          <FormField label={t("channels.dmPolicy")} tipKey="dmPolicy">
            <PolicySelect
              value={value.dmPolicy ?? "pairing"}
              onChange={(v) => onChange({ ...value, dmPolicy: v })}
              t={t}
            />
          </FormField>

          <FormField label={t("channels.groupPolicy")} tipKey="groupPolicy">
            <PolicySelect
              value={value.groupPolicy ?? "open"}
              onChange={(v) => onChange({ ...value, groupPolicy: v })}
              t={t}
            />
          </FormField>
        </FieldGrid>

        <FieldGrid>
          <FormField label="私聊白名单 (allowFrom)" tipKey="allowFrom">
            <ListInput
              value={value.allowFromInput ?? ""}
              onChange={(next) => onChange({ ...value, allowFromInput: next })}
              placeholder="每行一个 open_id；开放模式至少包含 *"
            />
          </FormField>

          <FormField label="群聊白名单 (groupAllowFrom)" tipKey="groupAllowFrom">
            <ListInput
              value={value.groupAllowFromInput ?? ""}
              onChange={(next) => onChange({ ...value, groupAllowFromInput: next })}
              placeholder="每行一个群 chat_id（如 oc_xxx）"
            />
          </FormField>
        </FieldGrid>

        <FormField
          label="群组规则 (groups)"
          tipKey="groups"
          headerRight={(
            <EditorModeToggle
              checked={value.useAdvancedGroups === true}
              onCheckedChange={(checked) => onChange({ ...value, useAdvancedGroups: checked })}
            />
          )}
        >
          {value.useAdvancedGroups === true ? (
            <ListInput
              value={value.groupsInput ?? ""}
              onChange={(next) => onChange({ ...value, groupsInput: next })}
              placeholder={'例如：{\n  "*": { "requireMention": true }\n}'}
            />
          ) : (
            <GroupsEditor value={groups} onChange={updateGroups} />
          )}
        </FormField>

        <FieldGrid>
          <FormSwitchField
            label="流式输出"
            tipKey="streaming"
            checked={value.streaming !== false}
            onCheckedChange={(checked) => onChange({ ...value, streaming: checked })}
          />
          <FormSwitchField
            label="分块流式输出"
            tipKey="blockStreaming"
            checked={value.blockStreaming !== false}
            onCheckedChange={(checked) => onChange({ ...value, blockStreaming: checked })}
          />
          <FormSwitchField
            label="输入中提示 (typingIndicator)"
            tipKey="typingIndicator"
            checked={value.typingIndicator !== false}
            onCheckedChange={(checked) => onChange({ ...value, typingIndicator: checked })}
          />
          <FormSwitchField
            label="发送者姓名解析 (resolveSenderNames)"
            tipKey="resolveSenderNames"
            checked={value.resolveSenderNames !== false}
            onCheckedChange={(checked) => onChange({ ...value, resolveSenderNames: checked })}
          />
        </FieldGrid>
      </FormSection>

      {(value.connectionMode ?? "websocket") === "webhook" && (
        <FormSection title="Webhook">
          <FieldGrid>
            <FormField label="Verification Token" tipKey="verificationToken">
              <Input
                value={value.verificationToken ?? ""}
                onChange={(e) => onChange({ ...value, verificationToken: e.target.value })}
                placeholder="Webhook 验证 Token"
                className="h-8 text-sm font-mono"
              />
            </FormField>
            <FormField label="Encrypt Key" tipKey="encryptKey" required>
              <PasswordInput
                value={value.encryptKey ?? ""}
                onChange={(next) => onChange({ ...value, encryptKey: next })}
                placeholder="Webhook 加密 Key"
              />
            </FormField>
            <FormField label="Webhook Path" tipKey="webhookPath">
              <Input
                value={value.webhookPath ?? ""}
                onChange={(event) => onChange({ ...value, webhookPath: event.target.value })}
                placeholder="/feishu/events"
                className="h-8 text-sm font-mono"
              />
            </FormField>
            <FormField label="Webhook Host" tipKey="webhookHost" required>
              <Input
                value={value.webhookHost ?? ""}
                onChange={(event) => onChange({ ...value, webhookHost: event.target.value })}
                placeholder="127.0.0.1"
                className="h-8 text-sm font-mono"
              />
            </FormField>
            <FormField label="Webhook Port" tipKey="webhookPort" required>
              <Input
                value={value.webhookPortInput ?? ""}
                onChange={(event) => onChange({ ...value, webhookPortInput: event.target.value })}
                placeholder="3000"
                className="h-8 text-sm font-mono"
              />
            </FormField>
          </FieldGrid>
        </FormSection>
      )}

      <div className="mt-1 flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
        <Button size="sm" onClick={onSave} disabled={saving} className="gap-1.5 text-xs h-8">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {t("channels.save")}
        </Button>
        <span className="text-[11px] text-muted-foreground">{t("channels.restartHint")}</span>
      </div>
    </div>
  )
}

// ── Telegram Config Form ─────────────────────────────────────────────────────

function TelegramConfigForm({
  value,
  onChange,
  saving,
  onSave,
}: {
  value: TelegramConfig
  onChange: (v: TelegramConfig) => void
  saving: boolean
  onSave: () => void
}) {
  const { t } = useI18n()
  const accounts = value.accountsDraft ?? []
  const groups = value.groupsDraft ?? []
  const hasConfigured = accounts.some((item) => item.botToken.trim() || item.tokenFile.trim())

  const updateAccounts = (nextAccounts: TelegramAccountDraft[]) => {
    const validIds = nextAccounts.map((item) => item.id.trim()).filter(Boolean)
    let nextDefault = value.defaultAccount?.trim() ?? ""
    if (!nextDefault || !validIds.includes(nextDefault)) {
      nextDefault = validIds[0] ?? ""
    }
    onChange({
      ...value,
      accountsDraft: nextAccounts,
      defaultAccount: nextDefault,
    })
  }

  const updateGroups = (nextGroups: GroupRuleDraft[]) => {
    onChange({ ...value, groupsDraft: nextGroups })
  }

  return (
    <div className="w-full space-y-5 pb-8">
      <div className="rounded-xl border bg-background px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl"><Send className="h-6 w-6" /></span>
            <h2 className="text-base font-semibold">{t("channels.telegram.name")}</h2>
            {hasConfigured && (
              <Badge variant={value.enabled !== false ? "default" : "secondary"} className="text-[10px] px-1.5 h-4">
                {value.enabled !== false ? t("channels.enabled") : t("channels.disabled")}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <FieldTip content={resolveTipText({ t, label: t("channels.enabled"), tipKey: "channelEnabled" })} />
            <Switch
              checked={value.enabled !== false}
              onCheckedChange={(checked) => onChange({ ...value, enabled: checked })}
            />
          </div>
        </div>
      </div>

      <FormSection title={t("channels.requiredFields")}>
        <FormField
          label="多账号配置"
          tipKey="multiAccount"
          required
          headerRight={(
            <EditorModeToggle
              checked={value.useAdvancedAccounts === true}
              onCheckedChange={(checked) => onChange({ ...value, useAdvancedAccounts: checked })}
            />
          )}
        >
          {value.useAdvancedAccounts === true ? (
            <ListInput
              value={value.accountsInput ?? ""}
              onChange={(next) => onChange({ ...value, accountsInput: next })}
              placeholder={'例如：{\n  "default": { "name": "Primary bot", "botToken": "123:abc" },\n  "alerts": { "name": "Alerts bot", "botToken": "456:def" }\n}'}
            />
          ) : (
            <TelegramAccountsEditor value={accounts} onChange={updateAccounts} />
          )}
        </FormField>
      </FormSection>

      <p className="px-1 text-[11px] text-muted-foreground">
        {t("channels.telegram.setupHint")}
      </p>

      <FormSection title={t("channels.optionalFields")}>
        <FieldGrid>
          <FormField label={t("channels.dmPolicy")} tipKey="dmPolicy">
            <PolicySelect
              value={value.dmPolicy ?? "pairing"}
              onChange={(v) => onChange({ ...value, dmPolicy: v })}
              t={t}
            />
          </FormField>

          <FormField label={t("channels.groupPolicy")} tipKey="groupPolicy">
            <PolicySelect
              value={value.groupPolicy ?? "allowlist"}
              onChange={(v) => onChange({ ...value, groupPolicy: v })}
              t={t}
            />
          </FormField>
        </FieldGrid>

        <FormField label="默认账户 (defaultAccount)" tipKey="defaultAccount">
          <Input
            value={value.defaultAccount ?? ""}
            onChange={(event) => onChange({ ...value, defaultAccount: event.target.value })}
            placeholder="default"
            className="h-8 text-sm font-mono"
          />
        </FormField>

        <FormField
          label="多 Agent 路由"
          tipKey="bindings"
          headerRight={(
            <EditorModeToggle
              checked={value.useAdvancedBindings === true}
              onCheckedChange={(checked) => onChange({ ...value, useAdvancedBindings: checked })}
            />
          )}
        >
          {value.useAdvancedBindings === true ? (
            <ListInput
              value={value.bindingsInput ?? ""}
              onChange={(next) => onChange({ ...value, bindingsInput: next })}
              placeholder={'例如：[\n  { "agentId": "main", "match": { "channel": "telegram", "accountId": "default" } },\n  { "agentId": "alerts", "match": { "channel": "telegram", "accountId": "alerts" } }\n]'}
            />
          ) : (
            <BindingsEditor
              channelId="telegram"
              value={value.bindingsDraft ?? []}
              onChange={(next) => onChange({ ...value, bindingsDraft: next })}
            />
          )}
        </FormField>

        <FieldGrid>
          <FormField label="私聊白名单 (allowFrom)" tipKey="allowFrom">
            <ListInput
              value={value.allowFromInput ?? ""}
              onChange={(next) => onChange({ ...value, allowFromInput: next })}
              placeholder="每行一个 Telegram 用户 ID；开放模式至少包含 *"
            />
          </FormField>

          <FormField label="群聊发言白名单 (groupAllowFrom)" tipKey="groupAllowFrom">
            <ListInput
              value={value.groupAllowFromInput ?? ""}
              onChange={(next) => onChange({ ...value, groupAllowFromInput: next })}
              placeholder="每行一个 Telegram 用户 ID"
            />
          </FormField>
        </FieldGrid>

        <FormField
          label="群组规则 (groups)"
          tipKey="groups"
          headerRight={(
            <EditorModeToggle
              checked={value.useAdvancedGroups === true}
              onCheckedChange={(checked) => onChange({ ...value, useAdvancedGroups: checked })}
            />
          )}
        >
          {value.useAdvancedGroups === true ? (
            <ListInput
              value={value.groupsInput ?? ""}
              onChange={(next) => onChange({ ...value, groupsInput: next })}
              placeholder={'例如：{\n  "*": { "requireMention": true }\n}'}
            />
          ) : (
            <GroupsEditor value={groups} onChange={updateGroups} />
          )}
        </FormField>

        <FormField label={t("channels.telegram.streaming")} tipKey="telegramStreaming">
          <Select
            value={value.streamMode ?? "partial"}
            onValueChange={(v) => onChange({ ...value, streamMode: v })}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t("channels.telegram.streamingOff")}</SelectItem>
              <SelectItem value="partial">{t("channels.telegram.streamingPartial")}</SelectItem>
              <SelectItem value="block">{t("channels.telegram.streamingBlock")}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        <FormSwitchField
          label="分块流式推送 (blockStreaming)"
          tipKey="blockStreamingPush"
          checked={value.blockStreaming === true}
          onCheckedChange={(checked) => onChange({ ...value, blockStreaming: checked })}
        />

        <FieldGrid>
          <FormField label="Webhook URL" tipKey="webhookUrl">
            <Input
              value={value.webhookUrl ?? ""}
              onChange={(event) => onChange({ ...value, webhookUrl: event.target.value })}
              placeholder="https://example.com/telegram/webhook"
              className="h-8 text-sm font-mono"
            />
          </FormField>

          <FormField label="Webhook Secret" tipKey="webhookSecret">
            <PasswordInput
              value={value.webhookSecret ?? ""}
              onChange={(next) => onChange({ ...value, webhookSecret: next })}
              placeholder="Telegram webhook 密钥"
            />
          </FormField>
        </FieldGrid>

        <FormField label="Webhook Path" tipKey="webhookPath">
          <Input
            value={value.webhookPath ?? ""}
            onChange={(event) => onChange({ ...value, webhookPath: event.target.value })}
            placeholder="/telegram-webhook"
            className="h-8 text-sm font-mono"
          />
        </FormField>
      </FormSection>

      <div className="mt-1 flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
        <Button size="sm" onClick={onSave} disabled={saving} className="gap-1.5 text-xs h-8">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {t("channels.save")}
        </Button>
        <span className="text-[11px] text-muted-foreground">{t("channels.restartHint")}</span>
      </div>
    </div>
  )
}
