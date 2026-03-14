

import { useState, useEffect } from "react"
import { ArrowLeft, Brain, Check, Languages, Info, RefreshCw, Download, CheckCircle2, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  LOCALE_OPTIONS,
  getLocaleLabel,
  useI18n,
  type LocalePreference,
} from "@/i18n"
import { cn } from "@/lib/utils"
import { ModelConfigPanel } from "./model-config"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SettingsSection = "models" | "language" | "about"

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t } = useI18n()
  const [activeSection, setActiveSection] = useState<SettingsSection>("models")
  const navItems: { id: SettingsSection; label: string; icon: typeof Brain | typeof Languages | typeof Info }[] = [
    { id: "models", label: t("settings.sections.models"), icon: Brain },
    { id: "language", label: t("settings.sections.language"), icon: Languages },
    { id: "about", label: "关于", icon: Info },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[80vw] !max-w-[1000px] h-[80vh] p-0 gap-0 overflow-hidden"
      >
        <div className="flex h-full overflow-hidden">
          {/* Sidebar */}
          <nav className="w-48 shrink-0 border-r bg-muted/30 flex flex-col">
            <div className="px-3 py-3 border-b">
              <button
                onClick={() => onOpenChange(false)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("settings.backToApp")}
              </button>
            </div>
            <div className="flex-1 py-2 px-2 space-y-0.5">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={cn(
                    "flex items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    activeSection === item.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              ))}
            </div>
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div className="px-5 py-4 border-b shrink-0">
              <h2 className="text-base font-medium">
                {navItems.find((n) => n.id === activeSection)?.label}
              </h2>
              {activeSection === "models" && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("settings.descriptions.models")}
                </p>
              )}
              {activeSection === "language" && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("settings.descriptions.language")}
                </p>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-5 py-4">
                {activeSection === "models" && <ModelConfigPanel />}
                {activeSection === "language" && <LanguageSettingsPanel />}
                {activeSection === "about" && <AboutPanel />}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LanguageSettingsPanel() {
  const { locale, preference, setPreference, t } = useI18n()

  const options: Array<{
    value: LocalePreference
    label: string
    description?: string
  }> = [
    {
      value: "system",
      label: t("settings.language.system"),
      description: t("settings.language.systemDescription"),
    },
    ...LOCALE_OPTIONS.map((option) => ({
      value: option.code,
      label: option.label,
    })),
  ]

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        {t("settings.language.current")}: {getLocaleLabel(locale)}
      </div>
      <div className="space-y-2">
        {options.map((option) => {
          const active = preference === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setPreference(option.value)}
              className={cn(
                "flex w-full items-start justify-between rounded-lg border px-4 py-3 text-left transition-colors",
                active
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent"
              )}
            >
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground">{option.label}</div>
                {option.description && (
                  <div className="text-xs text-muted-foreground">{option.description}</div>
                )}
              </div>
              {active && (
                <div className="rounded-full bg-primary/10 p-1 text-primary">
                  <Check className="h-4 w-4" />
                </div>
              )}
            </button>
          )
        })}
      </div>
      <Button variant="outline" onClick={() => setPreference("system")}>
        {t("settings.language.system")}
      </Button>
    </div>
  )
}

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available' }
  | { status: 'downloading'; progress: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; error: string }

function AboutPanel() {
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const [appVersion, setAppVersion] = useState<string>('…')

  useEffect(() => {
    window.ipc.appVersion().then(setAppVersion)
  }, [])

  const handleCheckUpdate = async () => {
    setUpdateState({ status: 'checking' })
    const unsubscribe = window.ipc.onAppUpdateStatus((s) => {
      if (s.status === 'available' && s.version) {
        setUpdateState({ status: 'available', version: s.version })
        unsubscribe()
      } else if (s.status === 'not-available') {
        setUpdateState({ status: 'not-available' })
        unsubscribe()
      } else if (s.status === 'downloading') {
        setUpdateState({ status: 'downloading', progress: s.progress ?? 0 })
      } else if (s.status === 'downloaded' && s.version) {
        setUpdateState({ status: 'downloaded', version: s.version })
        unsubscribe()
      } else if (s.status === 'error') {
        setUpdateState({ status: 'error', error: s.error ?? '未知错误' })
        unsubscribe()
      }
    })
    await window.ipc.appCheckUpdate()
  }

  return (
    <div className="space-y-6">
      {/* App info */}
      <div className="rounded-lg border bg-muted/20 px-4 py-3 space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">应用版本</span>
          <span className="font-mono font-medium">{appVersion}</span>
        </div>
      </div>

      {/* Update section */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">软件更新</h3>

        {updateState.status === 'idle' && (
          <Button variant="outline" size="sm" onClick={handleCheckUpdate} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            检查更新
          </Button>
        )}

        {updateState.status === 'checking' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在检查更新…
          </div>
        )}

        {updateState.status === 'not-available' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            已是最新版本
            <button onClick={() => setUpdateState({ status: 'idle' })} className="ml-auto text-xs underline underline-offset-2">重新检查</button>
          </div>
        )}

        {updateState.status === 'available' && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 px-4 py-3 space-y-2">
            <p className="text-sm font-medium">发现新版本 v{updateState.version}</p>
            <Button size="sm" onClick={() => { window.ipc.appDownloadUpdate(); setUpdateState({ status: 'downloading', progress: 0 }) }} className="gap-2">
              <Download className="h-3.5 w-3.5" />
              立即下载
            </Button>
          </div>
        )}

        {updateState.status === 'downloading' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">正在下载…</span>
              <span className="font-mono text-xs">{updateState.progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${updateState.progress}%` }} />
            </div>
          </div>
        )}

        {updateState.status === 'downloaded' && (
          <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30 px-4 py-3 space-y-2">
            <p className="text-sm font-medium">v{updateState.version} 已下载完成</p>
            <Button size="sm" onClick={() => window.ipc.appInstallUpdate()} className="gap-2">
              重启并安装
            </Button>
          </div>
        )}

        {updateState.status === 'error' && (
          <div className="space-y-2">
            <p className="text-sm text-destructive">{updateState.error}</p>
            <button onClick={() => setUpdateState({ status: 'idle' })} className="text-xs text-muted-foreground underline underline-offset-2">重试</button>
          </div>
        )}
      </div>
    </div>
  )
}
