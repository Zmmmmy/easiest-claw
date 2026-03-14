

import { useCallback, useEffect, useState } from "react"
import {
  Search,
  Loader2,
  Plus,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/i18n"
import { AddProviderDialog } from "./add-provider-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import type {
  ModelConfig,
  ModelProvider,
  ModelDefaults,
} from "./model-config-types"
import { API_TYPE_OPTIONS } from "./model-config-types"
import { KNOWN_PROVIDERS } from "./known-providers"
import { ProviderCard } from "./provider-card"

export function ModelConfigPanel() {
  const { t } = useI18n()
  const [providers, setProviders] = useState<Record<string, ModelProvider>>({})
  const [defaults, setDefaults] = useState<ModelDefaults>({ primary: "", fallbacks: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({})
  const [healthChecking, setHealthChecking] = useState<Record<string, boolean>>({})
  const [healthResults, setHealthResults] = useState<
    Record<string, { healthy: boolean; latencyMs?: number; error?: string }>
  >({})

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.ipc.openclawModelsGet()
      if (!res || !res.ok) throw new Error((res as { error?: string })?.error ?? 'Failed')
      const result = res as {
        providers: Record<string, ModelProvider>
        defaults: { primary: string; fallbacks: string[] }
      }
      setProviders(result.providers ?? {})
      setDefaults({
        primary: result.defaults?.primary ?? "",
        fallbacks: result.defaults?.fallbacks ?? [],
      })
    } catch (err) {
      toast.error(t("modelConfig.loadFailed") + String(err))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleSave = async () => {
    setSaving(true)
    try {
      const cleanProviders: Record<string, unknown> = {}
      for (const [id, prov] of Object.entries(providers)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _note, ...rest } = prov
        const cleanModels = rest.models.map((m) => {
          const writable: Record<string, unknown> = { id: m.id, name: m.name ?? m.id }
          if (m.reasoning !== undefined) writable.reasoning = m.reasoning
          if (m.contextWindow !== undefined) writable.contextWindow = m.contextWindow
          if (m.maxTokens !== undefined) writable.maxTokens = m.maxTokens
          // Preserve input capability array (e.g. ["text","image"]) — required for vision support
          if (Array.isArray(m.input) && m.input.length > 0) writable.input = m.input
          return writable
        })
        cleanProviders[id] = { ...rest, models: cleanModels }
      }

      const res = await window.ipc.openclawModelsSet({
        providers: cleanProviders,
        defaults: {
          primary: defaults.primary,
          fallbacks: defaults.fallbacks ?? [],
        },
      })
      if (!res || !res.ok) throw new Error((res as { error?: string })?.error ?? 'Save failed')
      toast.success(t("modelConfig.saved"))
      await loadData()
    } catch (err) {
      toast.error(t("modelConfig.saveFailed") + String(err))
    } finally {
      setSaving(false)
    }
  }

  const updateProvider = (id: string, patch: Partial<ModelProvider>) => {
    setProviders((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }))
  }

  const deleteProvider = (id: string) => {
    setProviders((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (defaults.primary?.startsWith(`${id}/`)) {
      setDefaults((d) => ({ ...d, primary: "" }))
    }
  }

  const renameProvider = (oldId: string, newId: string) => {
    const trimmed = newId.trim()
    if (!trimmed || trimmed === oldId || providers[trimmed]) return
    setProviders((prev) => {
      const { [oldId]: providerData, ...rest } = prev
      return { ...rest, [trimmed]: providerData }
    })
    // Update defaults.primary if it referenced the old provider
    if (defaults.primary?.startsWith(`${oldId}/`)) {
      setDefaults((d) => ({
        ...d,
        primary: d.primary!.replace(`${oldId}/`, `${trimmed}/`),
      }))
    }
    // Update expanded state
    setExpandedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(oldId)) {
        next.delete(oldId)
        next.add(trimmed)
      }
      return next
    })
  }

  const addModel = (providerId: string, modelId: string) => {
    const provider = providers[providerId]
    if (!provider) return
    if (provider.models.some((m) => m.id === modelId)) return
    updateProvider(providerId, {
      models: [...provider.models, { id: modelId }],
    })
  }

  const updateModel = (providerId: string, modelIdx: number, patch: Partial<ModelConfig>) => {
    const provider = providers[providerId]
    if (!provider) return
    const models = [...provider.models]
    models[modelIdx] = { ...models[modelIdx], ...patch }
    updateProvider(providerId, { models })
  }

  const deleteModel = (providerId: string, modelIdx: number) => {
    const provider = providers[providerId]
    if (!provider) return
    const deletedModelId = provider.models[modelIdx]?.id
    const models = provider.models.filter((_, i) => i !== modelIdx)
    updateProvider(providerId, { models })
    if (defaults.primary === `${providerId}/${deletedModelId}`) {
      setDefaults((d) => ({ ...d, primary: "" }))
    }
  }

  const addKnownProvider = (known: (typeof KNOWN_PROVIDERS)[number]) => {
    if (providers[known.id]) return
    const newProvider: ModelProvider = {
      baseUrl: known.baseUrl,
      apiKey: "",
      api: known.apiType || "openai-completions",
      models: known.models.map((m) => ({ id: m })),
    }
    setProviders((prev) => ({ ...prev, [known.id]: newProvider }))
    setExpandedProviders((prev) => new Set([...prev, known.id]))
  }

  const addCustomProvider = () => {
    let id = "custom"
    let counter = 1
    while (providers[id]) {
      id = `custom-${counter}`
      counter++
    }
    const newProvider: ModelProvider = {
      baseUrl: "",
      apiKey: "",
      api: "openai-completions",
      models: [],
    }
    setProviders((prev) => ({ ...prev, [id]: newProvider }))
    setExpandedProviders((prev) => new Set([...prev, id]))
  }

  const handleHealthCheck = async (providerId: string) => {
    const provider = providers[providerId]
    if (!provider) return
    setHealthChecking((prev) => ({ ...prev, [providerId]: true }))
    const start = Date.now()
    try {
      const result = await window.ipc.providerHealthCheck({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        api: provider.api,
      })
      setHealthResults((prev) => ({
        ...prev,
        [providerId]: {
          healthy: result.healthy,
          latencyMs: result.latencyMs ?? (Date.now() - start),
          error: result.error,
        },
      }))
    } catch (err) {
      setHealthResults((prev) => ({
        ...prev,
        [providerId]: { healthy: false, error: String(err) },
      }))
    } finally {
      setHealthChecking((prev) => ({ ...prev, [providerId]: false }))
    }
  }

  const toggleExpanded = (id: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Collect all models for primary selection
  const allModels: { label: string; value: string; hasKey: boolean }[] = []
  for (const [pid, prov] of Object.entries(providers)) {
    for (const m of prov.models) {
      allModels.push({
        label: `${pid}/${m.id}`,
        value: `${pid}/${m.id}`,
        hasKey: !!prov.apiKey,
      })
    }
  }

  // Filter providers by search query
  const filteredProviderIds = Object.keys(providers).filter((pid) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    if (pid.toLowerCase().includes(q)) return true
    const prov = providers[pid]
    return prov.models.some((m) => m.id.toLowerCase().includes(q))
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("modelConfig.loading")}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Primary Model Selection */}
      <div className="rounded-lg border p-3 space-y-2">
        <div className="text-sm font-medium">{t("modelConfig.activeConfig")}</div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground shrink-0">{t("modelConfig.primaryModel")}</label>
          <Select
              value={defaults.primary || ""}
              onValueChange={(v) => setDefaults((d) => ({ ...d, primary: v }))}
            >
              <SelectTrigger size="sm" className="flex-1">
                <SelectValue placeholder={t("modelConfig.notSelected")} />
              </SelectTrigger>
              <SelectContent>
                {allModels.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}{!m.hasKey ? t("modelConfig.noApiKey") : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
        </div>
        {defaults.primary && (
          <div className="text-xs text-muted-foreground">
            {t("modelConfig.current")} <span className="text-foreground font-medium">{defaults.primary}</span>
          </div>
        )}
      </div>

      {/* Search + Add Provider */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
          <Input
            placeholder={t("modelConfig.searchPlaceholder")}
            className="pl-8 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowQuickAdd(true)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t("modelConfig.addProvider")}
        </Button>
      </div>

      {/* Add Provider Dialog */}
      <AddProviderDialog
        open={showQuickAdd}
        onOpenChange={setShowQuickAdd}
        existingProviderIds={Object.keys(providers)}
        onAddKnown={addKnownProvider}
        onAddCustom={addCustomProvider}
      />

      {/* Provider List */}
      <div className="space-y-3">
          {filteredProviderIds.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-8">
              {searchQuery ? t("modelConfig.noMatch") : t("modelConfig.noProviders")}
            </div>
          )}

          {filteredProviderIds.map((pid) => {
            const prov = providers[pid]
            const expanded = expandedProviders.has(pid)
            const apiLabel =
              API_TYPE_OPTIONS.find((o) => o.value === prov.api)?.label || prov.api
            const health = healthResults[pid]
            const checking = healthChecking[pid]

            // Find known provider for this id to show quick-add model buttons
            const knownProv = KNOWN_PROVIDERS.find((kp) => kp.id === pid)
            const existingModelIds = new Set(prov.models.map((m) => m.id))
            const suggestedModels = knownProv
              ? knownProv.models.filter((m) => !existingModelIds.has(m))
              : []

            return (
              <ProviderCard
                key={pid}
                providerId={pid}
                provider={prov}
                expanded={expanded}
                apiLabel={apiLabel}
                health={health}
                checking={checking}
                suggestedModels={suggestedModels}
                showApiKeyVisible={!!showApiKey[pid]}
                onToggleExpand={() => toggleExpanded(pid)}
                onToggleApiKeyVisibility={() =>
                  setShowApiKey((prev) => ({ ...prev, [pid]: !prev[pid] }))
                }
                onUpdate={(patch) => updateProvider(pid, patch)}
                onRename={(newId) => renameProvider(pid, newId)}
                onDelete={() => deleteProvider(pid)}
                onHealthCheck={() => handleHealthCheck(pid)}
                onAddModel={(modelId) => addModel(pid, modelId)}
                onUpdateModel={(idx, patch) => updateModel(pid, idx, patch)}
                onDeleteModel={(idx) => deleteModel(pid, idx)}
              />
            )
          })}
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-1">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
          {saving ? t("modelConfig.saving") : t("modelConfig.saveConfig")}
        </Button>
      </div>
    </div>
  )
}
