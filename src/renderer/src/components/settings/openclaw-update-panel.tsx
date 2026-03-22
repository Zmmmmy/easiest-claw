import { useEffect, useState } from "react"
import {
    ArrowUpCircle,
    CheckCircle2,
    Loader2,
    RefreshCw,
    XCircle,
    Zap,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

interface UpdateInfo {
    current: string | null
    latest: string | null
    hasUpdate: boolean
}

type UpgradeStep = 'download' | 'stop' | 'migrate' | 'install' | 'start'

interface UpgradeState {
    running: boolean
    steps: Record<UpgradeStep, { status: 'pending' | 'running' | 'done' | 'error'; logs: string[] }>
}

const UPGRADE_STEP_KEYS: UpgradeStep[] = ['download', 'stop', 'migrate', 'install', 'start']

const EMPTY_UPGRADE_STEPS = (): UpgradeState['steps'] => ({
    download: { status: 'pending', logs: [] },
    stop: { status: 'pending', logs: [] },
    migrate: { status: 'pending', logs: [] },
    install: { status: 'pending', logs: [] },
    start: { status: 'pending', logs: [] },
})

const upgradeStepLabels: Record<UpgradeStep, string> = {
    download: '下载升级包',
    stop: '停止 Gateway',
    migrate: '备份旧版本',
    install: '解压新版本',
    start: '启动 Gateway',
}

export function OpenclawUpdatePanel() {
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
    const [checking, setChecking] = useState(false)
    const [upgrade, setUpgrade] = useState<UpgradeState>({ running: false, steps: EMPTY_UPGRADE_STEPS() })
    const [loading, setLoading] = useState(true)

    // 加载当前版本信息
    useEffect(() => {
        window.ipc.envDetect().then((res) => {
            const r = res as { ok: boolean; result?: { openclaw: { version?: string; activeSource: string } } }
            if (r.ok && r.result) {
                if (r.result.openclaw.version) {
                    setUpdateInfo({ current: r.result.openclaw.version, latest: null, hasUpdate: false })
                }
            }
        }).catch(() => {}).finally(() => setLoading(false))
    }, [])

    // 订阅升级进度
    useEffect(() => {
        const unsub = window.ipc.onUpgradeProgress(({ step, status, detail }) => {
            setUpgrade((prev) => {
                const s = prev.steps[step as UpgradeStep]
                if (!s) return prev
                const newLogs = status === 'running' && detail
                    ? [...s.logs.slice(-299), detail]
                    : s.logs
                return {
                    ...prev,
                    steps: {
                        ...prev.steps,
                        [step]: { status: status as 'running' | 'done' | 'error', logs: newLogs }
                    }
                }
            })
        })
        return () => { unsub() }
    }, [])

    // 恢复升级状态（页面切换后）
    useEffect(() => {
        window.ipc.openclawUpgradeStateGet().then((s) => {
            const state = s as { running: boolean; steps: Record<string, { status: string; logs: string[] }> }
            if (state.running || Object.values(state.steps).some(v => v.status !== 'pending')) {
                const pick = (key: string) => (state.steps[key] ?? { status: 'pending', logs: [] }) as { status: 'pending' | 'running' | 'done' | 'error'; logs: string[] }
                setUpgrade({
                    running: state.running,
                    steps: {
                        download: pick('download'),
                        stop: pick('stop'),
                        migrate: pick('migrate'),
                        install: pick('install'),
                        start: pick('start'),
                    }
                })
            }
        }).catch(() => {})
    }, [])

    const handleCheckUpdate = async () => {
        setChecking(true)
        try {
            const res = await window.ipc.openclawCheckUpdate()
            const r = res as { ok: boolean; result?: UpdateInfo }
            if (r.ok && r.result) {
                setUpdateInfo(r.result)
                if (!r.result.latest) toast.error('检查更新失败，请检查网络')
                else if (r.result.hasUpdate) toast.info(`发现新版本 ${r.result.latest}`)
                else toast.success('已是最新版本')
            }
        } catch {
            toast.error('检查更新失败')
        } finally {
            setChecking(false)
        }
    }

    const handleUpgrade = async (version: string) => {
        setUpgrade({ running: true, steps: EMPTY_UPGRADE_STEPS() })
        try {
            const res = await window.ipc.openclawUpgrade(version)
            const r = res as { ok: boolean; error?: string }
            if (r.ok) {
                toast.success(`升级成功，当前版本 ${version}`)
                setUpdateInfo(prev => prev ? { ...prev, hasUpdate: false, current: version } : null)
            } else {
                toast.error(r.error ?? '升级失败')
            }
        } catch {
            toast.error('升级失败')
        } finally {
            setUpgrade((prev) => ({ ...prev, running: false }))
        }
    }

    const visibleSteps = UPGRADE_STEP_KEYS.map(step =>
        [step, upgrade.steps[step]] as [UpgradeStep, { status: string; logs: string[] }]
    )

    const allLogs = (Object.entries(upgrade.steps) as [UpgradeStep, { status: string; logs: string[] }][])
        .flatMap(([, s]) => s.logs)

    const hasUpgradeError = Object.values(upgrade.steps).some(s => s.status === 'error')

    if (loading) return null

    return (
        <div className="space-y-3">
            <h3 className="text-sm font-medium">OpenClaw 更新</h3>

            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <span className="text-base leading-none select-none">🦞</span>
                    <div>
                        <p className="text-sm font-medium">OpenClaw</p>
                        <p className="text-xs text-muted-foreground">
                            当前版本：{updateInfo?.current ?? '未知'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {updateInfo?.hasUpdate && updateInfo.latest && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <ArrowUpCircle className="h-3.5 w-3.5" />
                            可升级至 {updateInfo.latest}
                        </span>
                    )}
                    {updateInfo && !updateInfo.hasUpdate && updateInfo.latest && (
                        <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            已是最新
                        </span>
                    )}
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCheckUpdate}
                        disabled={checking || upgrade.running}
                        className="h-7 text-xs"
                    >
                        {checking
                            ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />检查中</>
                            : <><RefreshCw className="h-3 w-3 mr-1" />检查更新</>
                        }
                    </Button>
                    {updateInfo?.hasUpdate && updateInfo.latest && (
                        <Button
                            size="sm"
                            onClick={() => handleUpgrade(updateInfo.latest!)}
                            disabled={upgrade.running}
                            className="h-7 text-xs"
                        >
                            {upgrade.running
                                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />升级中</>
                                : <><Zap className="h-3 w-3 mr-1" />立即升级</>
                            }
                        </Button>
                    )}
                </div>
            </div>

            {/* 升级进度 */}
            {(upgrade.running || hasUpgradeError) && (
                <>
                    <Separator />
                    <div className="space-y-2">
                        <div className="flex gap-4 text-xs text-muted-foreground mb-3">
                            {visibleSteps.map(([step, s]) => (
                                <div key={step} className="flex items-center gap-1">
                                    {s.status === 'done'
                                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                        : s.status === 'running'
                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                                            : s.status === 'error'
                                                ? <XCircle className="h-3.5 w-3.5 text-destructive" />
                                                : <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30" />
                                    }
                                    <span className={cn(
                                        s.status === 'running' && 'text-blue-600 dark:text-blue-400 font-medium',
                                        s.status === 'done' && 'text-green-600 dark:text-green-400',
                                        s.status === 'error' && 'text-destructive',
                                    )}>
                                        {upgradeStepLabels[step]}
                                    </span>
                                </div>
                            ))}
                        </div>
                        {allLogs.length > 0 && (
                            <div className="bg-zinc-950 rounded-md p-3 font-mono text-[11px] text-zinc-300 max-h-48 overflow-y-auto">
                                {allLogs.slice(-50).map((log, i) => (
                                    <div key={i} className="leading-5 truncate">{log}</div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

        </div>
    )
}
