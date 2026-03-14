

import { useEffect, useState } from "react"
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Check,
  X,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useI18n } from "@/i18n"

import type { ModelConfig, ModelProvider } from "./model-config-types"
import { API_TYPE_OPTIONS } from "./model-config-types"

export interface EditProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  providerId: string
  provider: ModelProvider
  suggestedModels: string[]
  onSave: (patch: Partial<ModelProvider>) => void
  onRename: (newId: string) => void
  onAddModel: (modelId: string) => void
  onUpdateModel: (idx: number, patch: Partial<ModelConfig>) => void
  onDeleteModel: (idx: number) => void
}

export function EditProviderDialog({
  open,
  onOpenChange,
  providerId,
  provider,
  suggestedModels,
  onSave,
  onRename,
  onAddModel,
  onUpdateModel,
  onDeleteModel,
}: EditProviderDialogProps) {
  const { t } = useI18n()
  const [showApiKey, setShowApiKey] = useState(false)
  const [addingModel, setAddingModel] = useState(false)
  const [newModelId, setNewModelId] = useState("")
  const [editingId, setEditingId] = useState(providerId)

  useEffect(() => {
    setEditingId(providerId)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("modelConfig.editProvider", { name: providerId })}
          </DialogTitle>
          <DialogDescription>
            {t("modelConfig.editProviderDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Provider Fields */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("modelConfig.providerId")}
              </label>
              <Input
                className="text-sm h-8 font-mono"
                placeholder="my-provider"
                value={editingId}
                onChange={(e) => setEditingId(e.target.value)}
                onBlur={() => {
                  const trimmed = editingId.trim()
                  if (trimmed && trimmed !== providerId) {
                    onRename(trimmed)
                  }
                }}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Base URL</label>
              <Input
                className="text-sm h-8"
                placeholder="https://api.openai.com/v1"
                value={provider.baseUrl}
                onChange={(e) => onSave({ baseUrl: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">API Key</label>
              <div className="flex items-center gap-1.5">
                <Input
                  className="text-sm h-8 flex-1"
                  type={showApiKey ? "text" : "password"}
                  placeholder="sk-..."
                  value={provider.apiKey}
                  onChange={(e) => onSave({ apiKey: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("modelConfig.apiType")}
                </label>
                <Select value={provider.api} onValueChange={(v) => onSave({ api: v })}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {API_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("modelConfig.note")}
                </label>
                <Input
                  className="text-sm h-8"
                  placeholder={t("modelConfig.notePlaceholder")}
                  value={provider._note || ""}
                  onChange={(e) => onSave({ _note: e.target.value })}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Model List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                {t("modelConfig.modelList")}
              </div>
              <span className="text-xs text-muted-foreground">
                {t("modelConfig.modelCount", { count: String(provider.models.length) })}
              </span>
            </div>

            <div className="space-y-2">
              {provider.models.map((model, idx) => (
                <DialogModelRow
                  key={`${model.id}-${idx}`}
                  model={model}
                  onUpdate={(patch) => onUpdateModel(idx, patch)}
                  onDelete={() => onDeleteModel(idx)}
                />
              ))}
            </div>

            {/* Add Model */}
            <div className="flex flex-wrap items-center gap-1.5">
              {addingModel ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    className="h-7 w-48 text-sm"
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
                  size="sm"
                  onClick={() => setAddingModel(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t("modelConfig.addModel")}
                </Button>
              )}
            </div>

            {/* Suggested Models */}
            {suggestedModels.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">
                  {t("modelConfig.suggestedModels")}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {suggestedModels.map((mid) => (
                    <Button
                      key={mid}
                      variant="ghost"
                      size="xs"
                      className="text-xs"
                      onClick={() => onAddModel(mid)}
                    >
                      <Plus className="h-2.5 w-2.5 mr-0.5" />
                      {mid}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("modelConfig.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Dialog Model Row ──────────────────────────────────────────

interface DialogModelRowProps {
  model: ModelConfig
  onUpdate: (patch: Partial<ModelConfig>) => void
  onDelete: () => void
}

function DialogModelRow({ model, onUpdate, onDelete }: DialogModelRowProps) {
  const { t } = useI18n()
  const hasVision = Array.isArray(model.input) && model.input.includes("image")
  const toggleVision = () => {
    onUpdate({ input: hasVision ? ["text"] : ["text", "image"] })
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm bg-muted/20">
      <div className="flex-1 min-w-0">
        <Input
          className="h-7 text-sm font-mono border-0 bg-transparent p-0 focus-visible:ring-0 focus-visible:border-0"
          value={model.id}
          onChange={(e) => onUpdate({ id: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant={model.reasoning ? "default" : "outline"}
          size="xs"
          className="text-xs h-6 px-2"
          onClick={() => onUpdate({ reasoning: !model.reasoning })}
        >
          {t("modelConfig.reasoning")}
        </Button>
        <Button
          variant={hasVision ? "default" : "outline"}
          size="xs"
          className="text-xs h-6 px-2"
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
