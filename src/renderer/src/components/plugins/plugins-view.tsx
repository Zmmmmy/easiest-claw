import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Eye,
  Loader2,
  Package,
  Puzzle,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Zap,
} from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useI18n } from "@/i18n"

interface PluginInfo {
  id: string
  name?: string
  version?: string
  description?: string
  kind?: string
  origin: "bundled" | "installed" | "load-path"
  enabled: boolean
  source?: string
  installPath?: string
}

interface MarketplaceInfo {
  name: string
  source?: string
  repo?: string
  installLocation?: string
  lastUpdated?: string
}

interface MarketplaceEntry {
  name: string
  scope: "plugins" | "external_plugins" | "unknown"
  path?: string
}

function resolveI18nLabel(t: (k: string) => string, key: string, fallback: string) {
  const translated = t(key)
  return translated === key ? fallback : translated
}

function pluginStableKey(plugin: PluginInfo, index: number): string {
  const suffix = plugin.installPath ?? plugin.source ?? `${index}`
  return `${plugin.id}::${plugin.origin}::${suffix}`
}

function dedupePlugins(plugins: PluginInfo[]): PluginInfo[] {
  const seen = new Set<string>()
  const result: PluginInfo[] = []
  for (let i = 0; i < plugins.length; i += 1) {
    const item = plugins[i]
    const key = pluginStableKey(item, i)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

export function PluginsView() {
  const { t } = useI18n()
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  const [installSpec, setInstallSpec] = useState("")
  const [installLink, setInstallLink] = useState(false)
  const [installPin, setInstallPin] = useState(false)
  const [installing, setInstalling] = useState(false)

  const [marketplace, setMarketplace] = useState("")
  const [marketplaces, setMarketplaces] = useState<MarketplaceInfo[]>([])
  const [marketplaceEntries, setMarketplaceEntries] = useState<MarketplaceEntry[]>([])
  const [marketplaceLoading, setMarketplaceLoading] = useState(false)
  const [marketplaceSource, setMarketplaceSource] = useState<"cli" | "local-cache" | "">("")

  const [updatingAll, setUpdatingAll] = useState(false)
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null)

  const [uninstallTarget, setUninstallTarget] = useState<PluginInfo | null>(null)
  const [uninstalling, setUninstalling] = useState(false)

  const [doctorOpen, setDoctorOpen] = useState(false)
  const [doctorLoading, setDoctorLoading] = useState(false)
  const [doctorReport, setDoctorReport] = useState("")

  const [inspectOpen, setInspectOpen] = useState(false)
  const [inspectLoading, setInspectLoading] = useState(false)
  const [inspectTitle, setInspectTitle] = useState("")
  const [inspectContent, setInspectContent] = useState("")

  const loadPlugins = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.ipc.pluginsList() as { ok: boolean; plugins?: PluginInfo[]; error?: string }
      if (res.ok && res.plugins) {
        setPlugins(dedupePlugins(res.plugins))
      } else {
        toast.error(t("plugins.loadError", { error: res.error ?? "Unknown" }))
      }
    } finally {
      setLoading(false)
    }
  }, [t])

  const loadKnownMarketplaces = useCallback(async () => {
    try {
      const res = await window.ipc.pluginsMarketplaces() as {
        ok: boolean
        marketplaces?: MarketplaceInfo[]
        error?: string
      }
      if (res.ok && res.marketplaces) {
        setMarketplaces(res.marketplaces)
        if (!marketplace && res.marketplaces.length > 0) {
          setMarketplace(res.marketplaces[0].name)
        }
      } else if (!res.ok) {
        toast.error(t("plugins.marketplaceLoadError", { error: res.error ?? "Unknown" }))
      }
    } catch (err) {
      toast.error(t("plugins.marketplaceLoadError", { error: String(err) }))
    }
  }, [marketplace, t])

  useEffect(() => {
    loadPlugins()
    loadKnownMarketplaces()
  }, [loadPlugins, loadKnownMarketplaces])

  const filtered = useMemo(() => {
    if (!search.trim()) return plugins
    const q = search.toLowerCase()
    return plugins.filter((p) =>
      p.id.toLowerCase().includes(q) ||
      p.name?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q),
    )
  }, [plugins, search])

  const handleInstall = async () => {
    const spec = installSpec.trim()
    if (!spec) {
      toast.error(t("plugins.installSpecRequired"))
      return
    }

    setInstalling(true)
    try {
      const res = await window.ipc.pluginsInstall({ spec, link: installLink, pin: installPin }) as {
        ok: boolean
        error?: string
      }
      if (res.ok) {
        toast.success(t("plugins.installSuccess", { spec }))
        setInstallSpec("")
        await loadPlugins()
      } else {
        toast.error(t("plugins.installError", { error: res.error ?? "Unknown" }))
      }
    } finally {
      setInstalling(false)
    }
  }

  const handleLoadMarketplaceEntries = async (targetMarketplace?: string) => {
    const selected = (targetMarketplace ?? marketplace).trim()
    if (!selected) {
      toast.error(t("plugins.marketplaceNameRequired"))
      return
    }

    setMarketplaceLoading(true)
    setMarketplaceEntries([])
    setMarketplaceSource("")
    try {
      const res = await window.ipc.pluginsMarketplaceList({ marketplace: selected }) as {
        ok: boolean
        entries?: MarketplaceEntry[]
        source?: "cli" | "local-cache"
        fallback?: boolean
        error?: string
      }
      if (res.ok) {
        setMarketplace(selected)
        setMarketplaceEntries(res.entries ?? [])
        setMarketplaceSource(res.source ?? "")
        if ((res.entries ?? []).length === 0) {
          toast.message(t("plugins.marketplaceEmpty", { marketplace: selected }))
        } else if (res.fallback) {
          toast.message(t("plugins.marketplaceLocalFallback", { marketplace: selected }))
        }
      } else {
        toast.error(t("plugins.marketplaceListError", { error: res.error ?? "Unknown" }))
      }
    } finally {
      setMarketplaceLoading(false)
    }
  }

  const handleUseMarketplaceEntry = (entry: MarketplaceEntry) => {
    if (!marketplace.trim()) {
      toast.error(t("plugins.marketplaceNameRequired"))
      return
    }
    setInstallSpec(`${entry.name}@${marketplace.trim()}`)
  }

  const handleToggleEnabled = async (plugin: PluginInfo) => {
    if (busyPluginId || uninstalling) return
    setBusyPluginId(plugin.id)
    try {
      const res = plugin.enabled
        ? await window.ipc.pluginsDisable({ pluginId: plugin.id })
        : await window.ipc.pluginsEnable({ pluginId: plugin.id })
      const result = res as { ok: boolean; error?: string }
      if (result.ok) {
        toast.success(
          plugin.enabled
            ? t("plugins.disableSuccess", { name: plugin.name ?? plugin.id })
            : t("plugins.enableSuccess", { name: plugin.name ?? plugin.id }),
        )
        await loadPlugins()
      } else {
        toast.error(
          plugin.enabled
            ? t("plugins.disableError", { error: result.error ?? "Unknown" })
            : t("plugins.enableError", { error: result.error ?? "Unknown" }),
        )
      }
    } finally {
      setBusyPluginId(null)
    }
  }

  const handleUpdate = async (plugin?: PluginInfo) => {
    if (busyPluginId || uninstalling || installing || updatingAll) return

    if (plugin) {
      setBusyPluginId(plugin.id)
    } else {
      setUpdatingAll(true)
    }

    try {
      const res = await window.ipc.pluginsUpdate(
        plugin ? { pluginId: plugin.id } : { all: true },
      ) as { ok: boolean; error?: string }
      if (res.ok) {
        toast.success(plugin
          ? t("plugins.updateSuccess", { name: plugin.name ?? plugin.id })
          : t("plugins.updateAllSuccess"))
        await loadPlugins()
      } else {
        toast.error(t("plugins.updateError", { error: res.error ?? "Unknown" }))
      }
    } finally {
      if (plugin) {
        setBusyPluginId(null)
      } else {
        setUpdatingAll(false)
      }
    }
  }

  const handleInspect = async (plugin: PluginInfo) => {
    if (busyPluginId || installing || uninstalling || updatingAll) return
    setBusyPluginId(plugin.id)
    setInspectLoading(true)
    setInspectOpen(true)
    setInspectTitle(plugin.name ?? plugin.id)
    setInspectContent("")

    try {
      const res = await window.ipc.pluginsInspect({ pluginId: plugin.id }) as {
        ok: boolean
        detail?: unknown
        output?: string
        error?: string
      }
      if (res.ok) {
        if (res.detail !== undefined) {
          setInspectContent(JSON.stringify(res.detail, null, 2))
        } else {
          setInspectContent(res.output ?? "")
        }
      } else {
        setInspectContent(res.error ?? "Unknown")
        toast.error(t("plugins.inspectError", { error: res.error ?? "Unknown" }))
      }
    } finally {
      setBusyPluginId(null)
      setInspectLoading(false)
    }
  }

  const handleDoctor = async () => {
    setDoctorOpen(true)
    setDoctorLoading(true)
    setDoctorReport("")
    try {
      const res = await window.ipc.pluginsDoctor() as {
        ok: boolean
        report?: string
        error?: string
      }
      if (res.ok) {
        setDoctorReport(res.report ?? t("plugins.doctorEmpty"))
      } else {
        const err = res.error ?? "Unknown"
        setDoctorReport(err)
        toast.error(t("plugins.doctorError", { error: err }))
      }
    } finally {
      setDoctorLoading(false)
    }
  }

  const handleUninstall = async () => {
    if (!uninstallTarget) return
    setUninstalling(true)
    try {
      const res = await window.ipc.pluginsUninstall({ pluginId: uninstallTarget.id }) as {
        ok: boolean
        error?: string
      }
      if (res.ok) {
        toast.success(t("plugins.uninstallSuccess", { name: uninstallTarget.name ?? uninstallTarget.id }))
        await loadPlugins()
      } else {
        toast.error(t("plugins.uninstallError", { error: res.error ?? "Unknown" }))
      }
    } finally {
      setUninstalling(false)
      setUninstallTarget(null)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-muted/20">
      <div
        className="shrink-0 flex items-center px-8 py-5 border-b bg-background"
        style={{
          WebkitAppRegion: "drag",
          ...(window.ipc.platform !== "darwin" ? { paddingRight: "154px" } : {}),
        } as React.CSSProperties}
      >
        <div
          className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 shrink-0"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <Puzzle className="h-5 w-5 text-primary" />
        </div>
        <div className="ml-3 flex-1 min-w-0" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <h1 className="text-lg font-semibold leading-tight">{t("plugins.title")}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t("plugins.description")}</p>
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <Button variant="outline" size="sm" className="h-8" onClick={handleDoctor} disabled={doctorLoading}>
            {doctorLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />}
            {t("plugins.doctor")}
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => handleUpdate()} disabled={updatingAll || loading}>
            {updatingAll ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
            {t("plugins.updateAll")}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={loadPlugins} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="px-8 pt-3 shrink-0">
        <div className="flex items-center gap-2">
          <Input
            className="h-8 text-sm"
            placeholder={t("plugins.installPlaceholder")}
            value={installSpec}
            onChange={(e) => setInstallSpec(e.target.value)}
            disabled={installing}
          />
          <Button size="sm" className="h-8 shrink-0" disabled={installing} onClick={handleInstall}>
            {installing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
            {t("plugins.install")}
          </Button>
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <Switch checked={installLink} onCheckedChange={(v) => setInstallLink(Boolean(v))} />
            {t("plugins.linkInstall")}
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <Switch checked={installPin} onCheckedChange={(v) => setInstallPin(Boolean(v))} />
            {t("plugins.pinInstall")}
          </label>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Input
            className="h-8 text-sm"
            placeholder={t("plugins.marketplacePlaceholder")}
            value={marketplace}
            onChange={(e) => setMarketplace(e.target.value)}
            disabled={marketplaceLoading}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            onClick={() => handleLoadMarketplaceEntries()}
            disabled={marketplaceLoading}
          >
            {marketplaceLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Search className="h-3.5 w-3.5 mr-1.5" />}
            {t("plugins.marketplaceList")}
          </Button>
        </div>

        {marketplaces.length > 0 && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground">{t("plugins.marketplaceKnown")}</span>
            {marketplaces.map((item) => (
              <Button
                key={item.name}
                variant={item.name === marketplace ? "default" : "outline"}
                size="sm"
                className="h-6 text-[11px]"
                onClick={() => {
                  setMarketplace(item.name)
                  handleLoadMarketplaceEntries(item.name)
                }}
                disabled={marketplaceLoading}
              >
                {item.name}
              </Button>
            ))}
          </div>
        )}

        {marketplaceEntries.length > 0 && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground">
              {marketplaceSource === "local-cache"
                ? t("plugins.marketplaceSourceLocal")
                : t("plugins.marketplaceSourceCli")}
            </span>
            {marketplaceEntries.slice(0, 30).map((entry) => (
              <Button
                key={`${entry.scope}:${entry.name}`}
                variant="secondary"
                size="sm"
                className="h-6 text-[11px]"
                onClick={() => handleUseMarketplaceEntry(entry)}
                title={entry.path ?? entry.name}
              >
                {entry.name}
              </Button>
            ))}
            {marketplaceEntries.length > 30 && (
              <span className="text-[11px] text-muted-foreground">
                {t("plugins.marketplaceMore", { count: String(marketplaceEntries.length - 30) })}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="px-8 py-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder={t("plugins.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-5">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">{t("plugins.loading")}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Package className="h-10 w-10 mb-3 opacity-40" />
            <span className="text-sm">{t("plugins.empty")}</span>
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((plugin, index) => (
              <PluginCard
                key={pluginStableKey(plugin, index)}
                plugin={plugin}
                busy={busyPluginId === plugin.id}
                onToggleEnabled={() => handleToggleEnabled(plugin)}
                onUpdate={() => handleUpdate(plugin)}
                onInspect={() => handleInspect(plugin)}
                onUninstall={() => setUninstallTarget(plugin)}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!uninstallTarget} onOpenChange={(open) => { if (!open) setUninstallTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("plugins.uninstallConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("plugins.uninstallConfirmDesc", { name: uninstallTarget?.name ?? uninstallTarget?.id ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={uninstalling}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUninstall}
              disabled={uninstalling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {uninstalling
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />{t("plugins.uninstalling")}</>
                : t("plugins.uninstall")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={doctorOpen} onOpenChange={setDoctorOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("plugins.doctorTitle")}</DialogTitle>
            <DialogDescription>{t("plugins.doctorDesc")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border bg-muted/20 p-3">
            {doctorLoading ? (
              <div className="flex items-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("plugins.doctorRunning")}
              </div>
            ) : (
              <pre className="text-xs leading-5 whitespace-pre-wrap break-words font-mono">
                {doctorReport || t("plugins.doctorEmpty")}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={inspectOpen} onOpenChange={setInspectOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{inspectTitle || t("plugins.inspectTitle")}</DialogTitle>
            <DialogDescription>{t("plugins.inspectDesc")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border bg-muted/20 p-3">
            {inspectLoading ? (
              <div className="flex items-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("plugins.inspectLoading")}
              </div>
            ) : (
              <pre className="text-xs leading-5 whitespace-pre-wrap break-words font-mono">
                {inspectContent || t("plugins.inspectEmpty")}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PluginCard({
  plugin,
  busy,
  onToggleEnabled,
  onUpdate,
  onInspect,
  onUninstall,
  t,
}: {
  plugin: PluginInfo
  busy: boolean
  onToggleEnabled: () => void
  onUpdate: () => void
  onInspect: () => void
  onUninstall: () => void
  t: (key: string, params?: Record<string, string>) => string
}) {
  const isBundled = plugin.origin === "bundled"
  const originVariant = isBundled ? "secondary" : plugin.origin === "load-path" ? "outline" : "default"
  const originLabel = resolveI18nLabel(t, `plugins.origin.${plugin.origin}`, plugin.origin)
  const kindLabel = plugin.kind
    ? resolveI18nLabel(t, `plugins.kind.${plugin.kind}`, plugin.kind)
    : ""

  return (
    <Card className="p-4 flex items-start gap-3">
      <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <Puzzle className="h-4.5 w-4.5 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium truncate">{plugin.name ?? plugin.id}</span>
          {plugin.version && (
            <span className="text-[11px] text-muted-foreground shrink-0">v{plugin.version}</span>
          )}
        </div>

        {plugin.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-1.5">{plugin.description}</p>
        )}

        {plugin.source && (
          <p className="text-[11px] text-muted-foreground truncate mb-1.5" title={plugin.source}>
            {plugin.source}
          </p>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant={originVariant} className="text-[10px] px-1.5 py-0">
            {originLabel}
          </Badge>
          {plugin.kind && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 max-w-[180px] truncate">
              {kindLabel}
            </Badge>
          )}
          <Badge
            variant={plugin.enabled ? "default" : "secondary"}
            className={cn(
              "text-[10px] px-1.5 py-0",
              plugin.enabled ? "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20" : "",
            )}
          >
            {plugin.enabled ? t("plugins.enabled") : t("plugins.disabled")}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Tooltip>
          <TooltipTrigger>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onInspect} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("plugins.inspect")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onUpdate} disabled={busy}>
              <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("plugins.update")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger>
            <div className="flex items-center px-2 h-8 rounded-md border">
              <Switch
                checked={plugin.enabled}
                onCheckedChange={onToggleEnabled}
                disabled={busy}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>{plugin.enabled ? t("plugins.disable") : t("plugins.enable")}</TooltipContent>
        </Tooltip>

        {isBundled ? (
          <Tooltip>
            <TooltipTrigger>
              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-30 cursor-not-allowed" disabled>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("plugins.cannotUninstallBundled")}</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={onUninstall}
                disabled={busy}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("plugins.uninstall")}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </Card>
  )
}
