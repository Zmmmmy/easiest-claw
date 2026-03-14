

import { useEffect, useState } from "react"
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Loader2,
  Check,
  X,
  Activity,
  Pencil,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useI18n } from "@/i18n"

import type { ModelConfig, ModelProvider } from "./model-config-types"
import { API_TYPE_OPTIONS } from "./model-config-types"
import { EditProviderDialog } from "./edit-provider-dialog"

// ─── Provider Card ────────────────────────────────────────────────

export interface ProviderCardProps {
  providerId: string
  provider: ModelProvider
  expanded: boolean
  apiLabel: string
  health?: { healthy: boolean; latencyMs?: number; error?: string }
  checking: boolean
  suggestedModels: string[]
  showApiKeyVisible: boolean
  onToggleExpand: () => void
  onToggleApiKeyVisibility: () => void
  onUpdate: (patch: Partial<ModelProvider>) => void
  onRename: (newId: string) => void
  onDelete: () => void
  onHealthCheck: () => void
  onAddModel: (modelId: string) => void
  onUpdateModel: (idx: number, patch: Partial<ModelConfig>) => void
  onDeleteModel: (idx: number) => void
}

export function ProviderCard({
  providerId,
  provider,
  expanded,
  apiLabel,
  health,
  checking,
  suggestedModels,
  showApiKeyVisible,
  onToggleExpand,
  onToggleApiKeyVisibility,
  onUpdate,
  onRename,
  onDelete,
  onHealthCheck,
  onAddModel,
  onUpdateModel,
  onDeleteModel,
}: ProviderCardProps) {
  const { t } = useI18n()
  const [addingModel, setAddingModel] = useState(false)
  const [newModelId, setNewModelId] = useState("")
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [inlineEditId, setInlineEditId] = useState(providerId)

  useEffect(() => {
    setInlineEditId(providerId)
  }, [providerId])

  const handleAddModel = () => {
    const trimmed = newModelId.trim()
    if (trimmed) {
      onAddModel(trimmed)
      setNewModelId("")
      setAddingModel(false)
    }
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggleExpand}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}

        <span className="font-medium text-sm">
          {providerId}
        </span>

        <Badge variant="secondary" className="text-[10px]">
          {apiLabel}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {t("modelConfig.modelCount", { count: String(provider.models.length) })}
        </span>

        {health && (
          <Badge variant={health.healthy ? "default" : "destructive"} className="text-[10px]">
            {health.healthy ? t("modelConfig.available", { ms: String(health.latencyMs) }) : t("modelConfig.unavailable")}
          </Badge>
        )}

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon-xs"
          title={t("modelConfig.editProvider", { name: providerId })}
          onClick={(e) => {
            e.stopPropagation()
            setEditDialogOpen(true)
          }}
        >
          <Pencil className="h-3 w-3" />
        </Button>

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation()
            onHealthCheck()
          }}
          disabled={checking || !provider.baseUrl}
        >
          {checking ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Activity className="h-3 w-3" />
          )}
        </Button>

        <Button
          variant="destructive"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation()
            if (window.confirm(t("modelConfig.deleteConfirm", { name: providerId }))) {
              onDelete()
            }
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Body */}
      {expanded && (
        <div className="px-3 py-2 space-y-3">
          {/* Provider Fields */}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 space-y-1">
              <label className="text-xs text-muted-foreground">{t("modelConfig.providerId")}</label>
              <Input
                className="text-xs h-7 font-mono"
                placeholder="my-provider"
                value={inlineEditId}
                onChange={(e) => setInlineEditId(e.target.value)}
                onBlur={() => {
                  const trimmed = inlineEditId.trim()
                  if (trimmed && trimmed !== providerId) {
                    onRename(trimmed)
                  }
                }}
              />
            </div>

            <div className="col-span-2 space-y-1">
              <label className="text-xs text-muted-foreground">Base URL</label>
              <Input
                className="text-xs h-7"
                placeholder="https://api.openai.com/v1"
                value={provider.baseUrl}
                onChange={(e) => onUpdate({ baseUrl: e.target.value })}
              />
            </div>

            <div className="col-span-2 space-y-1">
              <label className="text-xs text-muted-foreground">API Key</label>
              <div className="flex items-center gap-1">
                <Input
                  className="text-xs h-7 flex-1"
                  type={showApiKeyVisible ? "text" : "password"}
                  placeholder="sk-..."
                  value={provider.apiKey}
                  onChange={(e) => onUpdate({ apiKey: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={onToggleApiKeyVisibility}
                >
                  {showApiKeyVisible ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t("modelConfig.apiType")}</label>
              <Select value={provider.api} onValueChange={(v) => onUpdate({ api: v })}>
                <SelectTrigger size="sm" className="w-full h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {API_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t("modelConfig.note")}</label>
              <Input
                className="text-xs h-7"
                placeholder={t("modelConfig.notePlaceholder")}
                value={provider._note || ""}
                onChange={(e) => onUpdate({ _note: e.target.value })}
              />
            </div>
          </div>

          {health && !health.healthy && health.error && (
            <div className="text-xs text-destructive bg-destructive/5 rounded-md px-2 py-1.5">
              {health.error}
            </div>
          )}

          <Separator />

          {/* Model List */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">{t("modelConfig.modelList")}</div>
            {provider.models.map((model, idx) => (
              <ModelRow
                key={`${model.id}-${idx}`}
                model={model}
                onUpdate={(patch) => onUpdateModel(idx, patch)}
                onDelete={() => onDeleteModel(idx)}
              />
            ))}

            {/* Add Model */}
            <div className="flex flex-wrap items-center gap-1.5">
              {addingModel ? (
                <div className="flex items-center gap-1">
                  <Input
                    className="h-6 w-40 text-xs"
                    placeholder={t("modelConfig.modelIdPlaceholder")}
                    value={newModelId}
                    onChange={(e) => setNewModelId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddModel()
                      if (e.key === "Escape") {
                        setAddingModel(false)
                        setNewModelId("")
                      }
                    }}
                    autoFocus
                  />
                  <Button variant="ghost" size="icon-xs" onClick={handleAddModel}>
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                      setAddingModel(false)
                      setNewModelId("")
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setAddingModel(true)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {t("modelConfig.customModel")}
                </Button>
              )}

              {suggestedModels.map((mid) => (
                <Button
                  key={mid}
                  variant="ghost"
                  size="xs"
                  className="text-[10px]"
                  onClick={() => onAddModel(mid)}
                >
                  <Plus className="h-2.5 w-2.5 mr-0.5" />
                  {mid}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Edit Provider Dialog */}
      <EditProviderDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        providerId={providerId}
        provider={provider}
        suggestedModels={suggestedModels}
        onSave={onUpdate}
        onRename={onRename}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
      />
    </div>
  )
}

// ─── Model Row ────────────────────────────────────────────────────

interface ModelRowProps {
  model: ModelConfig
  onUpdate: (patch: Partial<ModelConfig>) => void
  onDelete: () => void
}

function ModelRow({ model, onUpdate, onDelete }: ModelRowProps) {
  const { t } = useI18n()
  const hasVision = Array.isArray(model.input) && model.input.includes("image")
  const toggleVision = () => {
    onUpdate({ input: hasVision ? ["text"] : ["text", "image"] })
  }
  return (
    <div className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs bg-background">
      <div className="flex-1 min-w-0">
        <Input
          className="h-6 text-xs font-mono border-0 bg-transparent p-0 focus-visible:ring-0 focus-visible:border-0"
          value={model.id}
          onChange={(e) => onUpdate({ id: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          variant={model.reasoning ? "default" : "outline"}
          size="xs"
          className="text-[10px] h-5 px-1.5"
          onClick={() => onUpdate({ reasoning: !model.reasoning })}
        >
          {t("modelConfig.reasoning")}
        </Button>
        <Button
          variant={hasVision ? "default" : "outline"}
          size="xs"
          className="text-[10px] h-5 px-1.5"
          onClick={toggleVision}
        >
          {t("modelConfig.vision")}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onDelete}>
          <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
        </Button>
      </div>
    </div>
  )
}
