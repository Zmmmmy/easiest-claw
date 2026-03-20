import type { CSSProperties, ReactNode } from "react"
import { useEffect, useState } from "react"
import { Eye, EyeOff, Loader2, Radio, RefreshCw, Save, Send } from "lucide-react"
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
import { cn } from "@/lib/utils"
import { useI18n } from "@/i18n"

// ── Types ────────────────────────────────────────────────────────────────────

type ChannelId = "feishu" | "telegram"

interface ChannelMeta {
  id: ChannelId
  icon: ReactNode
  nameKey: string
  descKey: string
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
  accountsInput?: string
  bindingsInput?: string
  webhookPortInput?: string
  accounts?: Record<string, { appId?: string; appSecret?: string; botName?: string; domain?: string; enabled?: boolean }>
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
  accountsInput?: string
  bindingsInput?: string
  accounts?: Record<string, { botToken?: string; tokenFile?: string; name?: string; enabled?: boolean }>
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
        const fsPrimary = isRecord(fsAccounts[fsDefaultAccount])
          ? fsAccounts[fsDefaultAccount]
          : isRecord(fsAccounts.main)
            ? fsAccounts.main
            : {}

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
          accountsInput: joinObject(fs.accounts),
          bindingsInput: joinArray(feishuBindings),
          verificationToken: fs.verificationToken ?? "",
          encryptKey: fs.encryptKey ?? "",
          webhookPath: typeof fs.webhookPath === "string" ? fs.webhookPath : "",
          webhookHost: typeof fs.webhookHost === "string" ? fs.webhookHost : "",
          webhookPortInput: typeof fs.webhookPort === "number" ? String(fs.webhookPort) : "",
          streaming: fs.streaming !== false,
          blockStreaming: fs.blockStreaming !== false,
          typingIndicator: fs.typingIndicator !== false,
          resolveSenderNames: fs.resolveSenderNames !== false,
          accounts: {
            main: {
              appId: typeof fsPrimary.appId === "string" ? fsPrimary.appId : "",
              appSecret: typeof fsPrimary.appSecret === "string" ? fsPrimary.appSecret : "",
              botName: typeof fsPrimary.botName === "string" ? fsPrimary.botName : "",
            },
          },
        })

        // Populate telegram form
        const tg = (channels.telegram ?? {}) as TelegramConfig
        const tgAccounts = isRecord(tg.accounts) ? tg.accounts : {}
        const tgDefaultAccount =
          typeof tg.defaultAccount === "string" && tg.defaultAccount.trim()
            ? tg.defaultAccount.trim()
            : (isRecord(tgAccounts.default) ? "default" : "main")
        const tgPrimary = isRecord(tgAccounts[tgDefaultAccount])
          ? tgAccounts[tgDefaultAccount]
          : isRecord(tgAccounts.main)
            ? tgAccounts.main
            : isRecord(tgAccounts.default)
              ? tgAccounts.default
              : {}

        setTelegramForm({
          enabled: tg.enabled !== false,
          botToken: tg.botToken ?? (typeof tgPrimary.botToken === "string" ? tgPrimary.botToken : ""),
          tokenFile: tg.tokenFile ?? (typeof tgPrimary.tokenFile === "string" ? tgPrimary.tokenFile : ""),
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
          accountsInput: joinObject(tg.accounts),
          bindingsInput: joinArray(telegramBindings),
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
      const rawBindingsInput = selected === "feishu" ? (feishuForm.bindingsInput ?? "") : (telegramForm.bindingsInput ?? "")
      const bindingsParsed = parseArrayInput(rawBindingsInput)
      if (bindingsParsed.error) {
        toast.error(`多 Agent 路由配置无效：${bindingsParsed.error}`)
        return
      }
      const normalizedBindings = normalizeBindingsForChannel(selected, bindingsParsed.value ?? [])
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
        const accountsParsed = parseObjectInput(feishuForm.accountsInput ?? "")
        if (accountsParsed.error) {
          toast.error(`飞书 accounts 配置无效：${accountsParsed.error}`)
          return
        }
        const advancedAccounts = accountsParsed.value
        const useAdvancedAccounts = Boolean(advancedAccounts && Object.keys(advancedAccounts).length > 0)
        const defaultAccount = feishuForm.defaultAccount?.trim() || undefined
        if (useAdvancedAccounts && defaultAccount && !isRecord(advancedAccounts?.[defaultAccount])) {
          toast.error(`defaultAccount=${defaultAccount} 在 accounts 中不存在`)
          return
        }

        const main = feishuForm.accounts?.main ?? {}
        if (!useAdvancedAccounts && !main.appId?.trim()) {
          toast.error(t("channels.feishu.appIdRequired"))
          return
        }
        if (!useAdvancedAccounts && !main.appSecret?.trim()) {
          toast.error(t("channels.feishu.appSecretRequired"))
          return
        }

        const allowFrom = splitList(feishuForm.allowFromInput ?? "")
        const groupAllowFrom = splitList(feishuForm.groupAllowFromInput ?? "")
        const groupsParsed = parseObjectInput(feishuForm.groupsInput ?? "")
        if (groupsParsed.error) {
          toast.error(`飞书 groups 配置无效：${groupsParsed.error}`)
          return
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
        const existingAccounts = isRecord(existing.accounts) ? existing.accounts : {}
        const accountKey = defaultAccount || "main"
        const existingMain = isRecord(existingAccounts[accountKey]) ? existingAccounts[accountKey] : {}
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
          groups: groupsParsed.value,
          verificationToken: feishuForm.verificationToken?.trim() || undefined,
          encryptKey: feishuForm.encryptKey?.trim() || undefined,
          webhookPath: feishuForm.webhookPath?.trim() || undefined,
          webhookHost: feishuForm.webhookHost?.trim() || undefined,
          webhookPort,
          streaming: feishuForm.streaming !== false,
          blockStreaming: feishuForm.blockStreaming !== false,
          typingIndicator: feishuForm.typingIndicator !== false,
          resolveSenderNames: feishuForm.resolveSenderNames !== false,
          accounts: useAdvancedAccounts
            ? advancedAccounts
            : {
                ...existingAccounts,
                [accountKey]: {
                  ...existingMain,
                  appId: main.appId.trim(),
                  appSecret: main.appSecret.trim(),
                  ...(main.botName?.trim() ? { botName: main.botName.trim() } : {}),
                },
              },
        }
      } else {
        const accountsParsed = parseObjectInput(telegramForm.accountsInput ?? "")
        if (accountsParsed.error) {
          toast.error(`Telegram accounts 配置无效：${accountsParsed.error}`)
          return
        }
        const advancedAccounts = accountsParsed.value
        const useAdvancedAccounts = Boolean(advancedAccounts && Object.keys(advancedAccounts).length > 0)
        const defaultAccount = telegramForm.defaultAccount?.trim() || undefined
        if (useAdvancedAccounts && defaultAccount && !isRecord(advancedAccounts?.[defaultAccount])) {
          toast.error(`defaultAccount=${defaultAccount} 在 accounts 中不存在`)
          return
        }

        const token = telegramForm.botToken?.trim() ?? ""
        const tokenFile = telegramForm.tokenFile?.trim() ?? ""
        if (!useAdvancedAccounts && !token && !tokenFile) {
          toast.error("请填写 Bot Token 或 tokenFile")
          return
        }

        const allowFrom = splitList(telegramForm.allowFromInput ?? "")
        const groupAllowFrom = splitList(telegramForm.groupAllowFromInput ?? "")
        const groupsParsed = parseObjectInput(telegramForm.groupsInput ?? "")
        if (groupsParsed.error) {
          toast.error(`Telegram groups 配置无效：${groupsParsed.error}`)
          return
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
        const existingAccounts = isRecord(existing.accounts) ? existing.accounts : {}
        const accountKey = defaultAccount || "default"
        const existingMain = isRecord(existingAccounts[accountKey]) ? existingAccounts[accountKey] : {}
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
          groups: groupsParsed.value,
          accounts: useAdvancedAccounts
            ? advancedAccounts
            : {
                ...existingAccounts,
                [accountKey]: {
                  ...existingMain,
                  ...(token ? { botToken: token } : {}),
                  ...(tokenFile ? { tokenFile } : {}),
                },
              },
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
    <div className="flex-1 flex flex-col overflow-hidden bg-muted/20">
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
          <div className="w-[200px] shrink-0 border-r bg-background overflow-y-auto py-2">
            {CHANNELS.map((ch) => (
              <button
                key={ch.id}
                className={cn(
                  "w-full flex items-center gap-2.5 px-4 py-3 text-left transition-colors",
                  selected === ch.id ? "bg-accent" : "hover:bg-accent/50",
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
          <div className="flex-1 overflow-y-auto px-8 py-6">
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
    <div className="mb-4 rounded-lg border bg-background px-4 py-3">
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
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  )
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
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
  const main = value.accounts?.main ?? {}

  const updateMain = (patch: Partial<typeof main>) => {
    onChange({
      ...value,
      accounts: {
        ...value.accounts,
        main: { ...main, ...patch },
      },
    })
  }

  return (
    <div className="max-w-lg space-y-6">
      {/* Header with switch */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl"><FeishuIcon className="h-6 w-6" /></span>
          <h2 className="text-base font-semibold">{t("channels.feishu.name")}</h2>
          {main.appId && (
            <Badge variant={value.enabled !== false ? "default" : "secondary"} className="text-[10px] px-1.5 h-4">
              {value.enabled !== false ? t("channels.enabled") : t("channels.disabled")}
            </Badge>
          )}
        </div>
        <Switch
          checked={value.enabled !== false}
          onCheckedChange={(checked) => onChange({ ...value, enabled: checked })}
        />
      </div>

      {/* Required fields */}
      <FormSection title={t("channels.requiredFields")}>
        <FormField label="App ID" required>
          <Input
            value={main.appId ?? ""}
            onChange={(e) => updateMain({ appId: e.target.value })}
            placeholder="cli_a1b2c3d4e5f6"
            className="h-8 text-sm font-mono"
          />
        </FormField>

        <FormField label="App Secret" required>
          <PasswordInput
            value={main.appSecret ?? ""}
            onChange={(v) => updateMain({ appSecret: v })}
            placeholder={t("channels.feishu.appSecretPlaceholder")}
          />
        </FormField>
      </FormSection>

      <p className="text-[11px] text-muted-foreground">
        {t("channels.feishu.setupHint")}
      </p>

      {/* Optional fields */}
      <FormSection title={t("channels.optionalFields")}>
        <FormField label={t("channels.feishu.botName")}>
          <Input
            value={main.botName ?? ""}
            onChange={(e) => updateMain({ botName: e.target.value })}
            placeholder={t("channels.feishu.botNamePlaceholder")}
            className="h-8 text-sm"
          />
        </FormField>

        <FormField label={t("channels.feishu.domain")}>
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

        <FormField label={t("channels.feishu.connectionMode")}>
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

        <FormField label="默认账户 (defaultAccount)">
          <Input
            value={value.defaultAccount ?? ""}
            onChange={(event) => onChange({ ...value, defaultAccount: event.target.value })}
            placeholder="main"
            className="h-8 text-sm font-mono"
          />
        </FormField>

        <FormField label="多账号配置 (accounts JSON)">
          <ListInput
            value={value.accountsInput ?? ""}
            onChange={(next) => onChange({ ...value, accountsInput: next })}
            placeholder={'例如：{\n  "main": { "appId": "cli_xxx", "appSecret": "xxx" },\n  "backup": { "appId": "cli_yyy", "appSecret": "yyy", "enabled": false }\n}'}
          />
        </FormField>

        <FormField label="多 Agent 路由 (bindings JSON)">
          <ListInput
            value={value.bindingsInput ?? ""}
            onChange={(next) => onChange({ ...value, bindingsInput: next })}
            placeholder={'例如：[\n  { "agentId": "main", "match": { "channel": "feishu", "accountId": "main" } },\n  { "agentId": "ops", "match": { "channel": "feishu", "peer": { "kind": "group", "id": "oc_xxx" } } }\n]'}
          />
        </FormField>

        <FormField label={t("channels.dmPolicy")}>
          <PolicySelect
            value={value.dmPolicy ?? "pairing"}
            onChange={(v) => onChange({ ...value, dmPolicy: v })}
            t={t}
          />
        </FormField>

        <FormField label={t("channels.groupPolicy")}>
          <PolicySelect
            value={value.groupPolicy ?? "open"}
            onChange={(v) => onChange({ ...value, groupPolicy: v })}
            t={t}
          />
        </FormField>

        <FormField label="私聊白名单 (allowFrom)">
          <ListInput
            value={value.allowFromInput ?? ""}
            onChange={(next) => onChange({ ...value, allowFromInput: next })}
            placeholder="每行一个 open_id；开放模式至少包含 *"
          />
        </FormField>

        <FormField label="群聊白名单 (groupAllowFrom)">
          <ListInput
            value={value.groupAllowFromInput ?? ""}
            onChange={(next) => onChange({ ...value, groupAllowFromInput: next })}
            placeholder="每行一个群 chat_id（如 oc_xxx）"
          />
        </FormField>

        <FormField label="群组高级配置 (groups JSON)">
          <ListInput
            value={value.groupsInput ?? ""}
            onChange={(next) => onChange({ ...value, groupsInput: next })}
            placeholder={'例如：{\n  "*": { "requireMention": true }\n}'}
          />
        </FormField>

        <FormField label="流式输出">
          <Switch
            checked={value.streaming !== false}
            onCheckedChange={(checked) => onChange({ ...value, streaming: checked })}
          />
        </FormField>

        <FormField label="分块流式输出">
          <Switch
            checked={value.blockStreaming !== false}
            onCheckedChange={(checked) => onChange({ ...value, blockStreaming: checked })}
          />
        </FormField>

        <FormField label="输入中提示 (typingIndicator)">
          <Switch
            checked={value.typingIndicator !== false}
            onCheckedChange={(checked) => onChange({ ...value, typingIndicator: checked })}
          />
        </FormField>

        <FormField label="发送者姓名解析 (resolveSenderNames)">
          <Switch
            checked={value.resolveSenderNames !== false}
            onCheckedChange={(checked) => onChange({ ...value, resolveSenderNames: checked })}
          />
        </FormField>

        {(value.connectionMode ?? "websocket") === "webhook" && (
          <>
            <FormField label="Verification Token">
              <Input
                value={value.verificationToken ?? ""}
                onChange={(e) => onChange({ ...value, verificationToken: e.target.value })}
                placeholder="Webhook 验证 Token"
                className="h-8 text-sm font-mono"
              />
            </FormField>
            <FormField label="Encrypt Key">
              <PasswordInput
                value={value.encryptKey ?? ""}
                onChange={(next) => onChange({ ...value, encryptKey: next })}
                placeholder="Webhook 加密 Key"
              />
            </FormField>
            <FormField label="Webhook Path">
              <Input
                value={value.webhookPath ?? ""}
                onChange={(event) => onChange({ ...value, webhookPath: event.target.value })}
                placeholder="/feishu/events"
                className="h-8 text-sm font-mono"
              />
            </FormField>
            <FormField label="Webhook Host">
              <Input
                value={value.webhookHost ?? ""}
                onChange={(event) => onChange({ ...value, webhookHost: event.target.value })}
                placeholder="127.0.0.1"
                className="h-8 text-sm font-mono"
              />
            </FormField>
            <FormField label="Webhook Port">
              <Input
                value={value.webhookPortInput ?? ""}
                onChange={(event) => onChange({ ...value, webhookPortInput: event.target.value })}
                placeholder="3000"
                className="h-8 text-sm font-mono"
              />
            </FormField>
          </>
        )}
      </FormSection>

      {/* Save button */}
      <div className="flex items-center gap-2 pt-2">
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

  return (
    <div className="max-w-lg space-y-6">
      {/* Header with switch */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl"><Send className="h-6 w-6" /></span>
          <h2 className="text-base font-semibold">{t("channels.telegram.name")}</h2>
          {value.botToken && (
            <Badge variant={value.enabled !== false ? "default" : "secondary"} className="text-[10px] px-1.5 h-4">
              {value.enabled !== false ? t("channels.enabled") : t("channels.disabled")}
            </Badge>
          )}
        </div>
        <Switch
          checked={value.enabled !== false}
          onCheckedChange={(checked) => onChange({ ...value, enabled: checked })}
        />
      </div>

      {/* Required fields */}
      <FormSection title={t("channels.requiredFields")}>
        <FormField label="Bot Token">
          <PasswordInput
            value={value.botToken ?? ""}
            onChange={(v) => onChange({ ...value, botToken: v })}
            placeholder="123456789:ABCDefGHiJKlmnoPQRstuvwXYZ"
          />
        </FormField>
        <FormField label="Token 文件路径 (tokenFile)">
          <Input
            value={value.tokenFile ?? ""}
            onChange={(event) => onChange({ ...value, tokenFile: event.target.value })}
            placeholder="/path/to/telegram.token"
            className="h-8 text-sm font-mono"
          />
        </FormField>
      </FormSection>

      <p className="text-[11px] text-muted-foreground">
        {t("channels.telegram.setupHint")}
      </p>

      {/* Optional fields */}
      <FormSection title={t("channels.optionalFields")}>
        <FormField label={t("channels.dmPolicy")}>
          <PolicySelect
            value={value.dmPolicy ?? "pairing"}
            onChange={(v) => onChange({ ...value, dmPolicy: v })}
            t={t}
          />
        </FormField>

        <FormField label={t("channels.groupPolicy")}>
          <PolicySelect
            value={value.groupPolicy ?? "allowlist"}
            onChange={(v) => onChange({ ...value, groupPolicy: v })}
            t={t}
          />
        </FormField>

        <FormField label="默认账户 (defaultAccount)">
          <Input
            value={value.defaultAccount ?? ""}
            onChange={(event) => onChange({ ...value, defaultAccount: event.target.value })}
            placeholder="default"
            className="h-8 text-sm font-mono"
          />
        </FormField>

        <FormField label="多账号配置 (accounts JSON)">
          <ListInput
            value={value.accountsInput ?? ""}
            onChange={(next) => onChange({ ...value, accountsInput: next })}
            placeholder={'例如：{\n  "default": { "name": "Primary bot", "botToken": "123:abc" },\n  "alerts": { "name": "Alerts bot", "botToken": "456:def" }\n}'}
          />
        </FormField>

        <FormField label="多 Agent 路由 (bindings JSON)">
          <ListInput
            value={value.bindingsInput ?? ""}
            onChange={(next) => onChange({ ...value, bindingsInput: next })}
            placeholder={'例如：[\n  { "agentId": "main", "match": { "channel": "telegram", "accountId": "default" } },\n  { "agentId": "alerts", "match": { "channel": "telegram", "accountId": "alerts" } }\n]'}
          />
        </FormField>

        <FormField label="私聊白名单 (allowFrom)">
          <ListInput
            value={value.allowFromInput ?? ""}
            onChange={(next) => onChange({ ...value, allowFromInput: next })}
            placeholder="每行一个 Telegram 用户 ID；开放模式至少包含 *"
          />
        </FormField>

        <FormField label="群聊发言白名单 (groupAllowFrom)">
          <ListInput
            value={value.groupAllowFromInput ?? ""}
            onChange={(next) => onChange({ ...value, groupAllowFromInput: next })}
            placeholder="每行一个 Telegram 用户 ID"
          />
        </FormField>

        <FormField label="群组高级配置 (groups JSON)">
          <ListInput
            value={value.groupsInput ?? ""}
            onChange={(next) => onChange({ ...value, groupsInput: next })}
            placeholder={'例如：{\n  "*": { "requireMention": true }\n}'}
          />
        </FormField>

        <FormField label={t("channels.telegram.streaming")}>
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

        <FormField label="分块流式推送 (blockStreaming)">
          <Switch
            checked={value.blockStreaming === true}
            onCheckedChange={(checked) => onChange({ ...value, blockStreaming: checked })}
          />
        </FormField>

        <FormField label="Webhook URL">
          <Input
            value={value.webhookUrl ?? ""}
            onChange={(event) => onChange({ ...value, webhookUrl: event.target.value })}
            placeholder="https://example.com/telegram/webhook"
            className="h-8 text-sm font-mono"
          />
        </FormField>

        <FormField label="Webhook Secret">
          <PasswordInput
            value={value.webhookSecret ?? ""}
            onChange={(next) => onChange({ ...value, webhookSecret: next })}
            placeholder="Telegram webhook 密钥"
          />
        </FormField>

        <FormField label="Webhook Path">
          <Input
            value={value.webhookPath ?? ""}
            onChange={(event) => onChange({ ...value, webhookPath: event.target.value })}
            placeholder="/telegram-webhook"
            className="h-8 text-sm font-mono"
          />
        </FormField>
      </FormSection>

      {/* Save button */}
      <div className="flex items-center gap-2 pt-2">
        <Button size="sm" onClick={onSave} disabled={saving} className="gap-1.5 text-xs h-8">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {t("channels.save")}
        </Button>
        <span className="text-[11px] text-muted-foreground">{t("channels.restartHint")}</span>
      </div>
    </div>
  )
}
