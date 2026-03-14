
import { AlertCircle, Loader2, Settings } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useI18n } from "@/i18n"
import { useApp } from "@/store/app-context"

interface CreateAgentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

const MAX_NAME_LENGTH = 30
const MAX_EMOJI_LENGTH = 2

export function CreateAgentDialog({ open, onOpenChange }: CreateAgentDialogProps) {
  const { dispatch } = useApp()
  const { t } = useI18n()
  const [name, setName] = useState("")
  const [emoji, setEmoji] = useState("")
  const [model, setModel] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<{ label: string; value: string }[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)

  useEffect(() => {
    if (!open) return
    setModelsLoading(true)
    setModelsLoaded(false)
    window.ipc.openclawModelsGet().then((res) => {
      if (!res || !res.ok) {
        setAvailableModels([])
        return
      }
      const result = res as {
        providers: Record<string, { models: { id: string }[]; apiKey?: string }>
        defaults: { primary: string; fallbacks: string[] }
      }
      const models: { label: string; value: string }[] = []
      for (const [pid, prov] of Object.entries(result.providers ?? {})) {
        for (const m of prov.models ?? []) {
          models.push({ label: `${pid}/${m.id}`, value: `${pid}/${m.id}` })
        }
      }
      setAvailableModels(models)
      // Auto-select: prefer defaults.primary if it exists in the list, else first available
      const primary = (result.defaults?.primary ?? "").trim()
      const autoSelect = models.find((m) => m.value === primary)?.value ?? models[0]?.value ?? ""
      setModel(autoSelect)
    }).catch(() => {
      setAvailableModels([])
    }).finally(() => {
      setModelsLoading(false)
      setModelsLoaded(true)
    })
  }, [open])

  const resetForm = () => {
    setName("")
    setEmoji("")
    setModel("")
    setLoading(false)
    setError(null)
    setAvailableModels([])
    setModelsLoaded(false)
    setModelsLoading(false)
  }

  const handleGoToSettings = () => {
    onOpenChange(false)
    resetForm()
    window.dispatchEvent(new CustomEvent("tg:open-settings"))
  }

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed || !model.trim()) return

    setLoading(true)
    setError(null)

    try {
      const result = await window.ipc.agentsCreate({
        name: trimmed,
        ...(emoji.trim() ? { emoji: emoji.trim() } : {}),
        model: model.trim(),
      })

      if (!result.ok) {
        setError((result as { error?: string }).error || t("createAgent.createFailed"))
        return
      }

      const payload = (result as { result?: { agentId?: string; name?: string } }).result
      const agentId = payload?.agentId ?? payload?.name ?? trimmed
      const displayName = (result as { displayName?: string }).displayName ?? trimmed
      dispatch({ type: "ADD_AGENT", payload: { agentId, name: displayName, emoji: emoji.trim() || undefined } })
      toast.success(t("createAgent.success", { name: displayName }))
      onOpenChange(false)
      resetForm()
    } catch {
      setError(t("createAgent.networkError"))
    } finally {
      setLoading(false)
    }
  }

  const noModels = modelsLoaded && availableModels.length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (loading) return
        onOpenChange(v)
        if (!v) resetForm()
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("createAgent.title")}</DialogTitle>
          <DialogDescription>{t("createAgent.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Label>{t("createAgent.nameLabel")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
                placeholder={t("createAgent.namePlaceholder")}
                disabled={loading}
                autoFocus
              />
              <p className="text-xs text-muted-foreground text-right">
                {name.length}/{MAX_NAME_LENGTH}
              </p>
            </div>
            <div className="w-20 space-y-2">
              <Label>{t("createAgent.emojiLabel")}</Label>
              <Input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value.slice(0, MAX_EMOJI_LENGTH))}
                placeholder="🤖"
                disabled={loading}
                className="text-center text-lg"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("createAgent.modelLabel")}</Label>
            {modelsLoading ? (
              <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t("createAgent.modelsLoading")}</span>
              </div>
            ) : noModels ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      {t("createAgent.noModelsTitle")}
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                      {t("createAgent.noModelsDesc")}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 underline transition-colors"
                  onClick={handleGoToSettings}
                >
                  <Settings className="h-3 w-3" />
                  {t("createAgent.goToModelSettings")}
                </button>
              </div>
            ) : (
              <>
                <Select value={model} onValueChange={setModel} disabled={loading}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("createAgent.modelPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("createAgent.modelHelper")}
                </p>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || !model.trim() || loading || noModels || modelsLoading}
          >
            {loading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {loading ? t("common.creating") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
