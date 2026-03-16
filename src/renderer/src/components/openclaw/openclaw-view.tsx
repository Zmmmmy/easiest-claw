import React, {useEffect, useState} from "react"
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    ExternalLink,
    Loader2,
    Package,
    PlayCircle,
    Server,
    Wifi,
    WifiOff,
    XCircle,
} from "lucide-react"
import {toast} from "sonner"
import {Button} from "@/components/ui/button"
import {Badge} from "@/components/ui/badge"
import {Card} from "@/components/ui/card"
import {Separator} from "@/components/ui/separator"
import {useI18n} from "@/i18n"
import {cn} from "@/lib/utils"
import {useApp} from "@/store/app-context"

interface EnvInfo {
    os: { platform: string; name: string; release: string; arch: string }
    node: {
        version: string
        activeSource: 'system' | 'bundled'
        activeReason: string
        system: { available: boolean; version: string; path?: string | null; satisfies: boolean } | null
        bundled: { available: boolean; version: string }
    }
    openclaw: {
        version?: string
        running: boolean
        canStart: boolean
        system: { available: boolean; version?: string; running: boolean; port: number; token: string | null; path?: string | null } | null
        bundled: { available: boolean; version?: string; path?: string | null }
        activeSource: 'system' | 'bundled' | 'external'
        activeReason: string
    }
}

type InstallStep = 'node' | 'init' | 'start' | 'connect'

interface InstallState {
    running: boolean
    steps: Record<InstallStep, { status: 'pending' | 'running' | 'done' | 'error'; detail?: string; logs: string[] }>
}

const EMPTY_STEPS = (): InstallState['steps'] => ({
    node: {status: 'pending', logs: []},
    init: {status: 'pending', logs: []},
    start: {status: 'pending', logs: []},
    connect: {status: 'pending', logs: []},
})

export function OpenclawView() {
    const {state} = useApp()
    const {t} = useI18n()
    const [env, setEnv] = useState<EnvInfo | null>(null)
    const [envLoading, setEnvLoading] = useState(true)
    const [install, setInstall] = useState<InstallState>({running: false, steps: EMPTY_STEPS()})
    const [switchingToBundled, setSwitchingToBundled] = useState(false)
    const [gwLogs, setGwLogs] = useState<Array<{ line: string; isError: boolean }>>([])
    const [consoleUrl, setConsoleUrl] = useState<string | null>(null)
    const [gatewayUrl, setGatewayUrl] = useState<string | null>(null)

    const connStatus = state.connectionStatus ?? "disconnected"

    // 加载设置（获取 gateway URL + 构造控制台链接）
    useEffect(() => {
        window.ipc.settingsGetFull().then((res) => {
            const s = res as { gateway?: { url?: string; token?: string } | null }
            const gw = s?.gateway
            const url = gw?.url ?? null
            const token = gw?.token ?? null
            setGatewayUrl(url)
            if (url && token) {
                const httpUrl = url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
                setConsoleUrl(`${httpUrl}/?token=${encodeURIComponent(token)}`)
            }
        }).catch(() => {})
    }, [])

    const loadEnv = () => {
        setEnvLoading(true)
        window.ipc.envDetect().then((res) => {
            const r = res as { ok: boolean; result?: EnvInfo }
            if (r.ok && r.result) setEnv(r.result)
        }).catch(() => {}).finally(() => setEnvLoading(false))
    }

    useEffect(() => { loadEnv() }, [])

    // 连接状态变化时重新检测环境（更新 running 状态）
    useEffect(() => {
        if (connStatus === 'connected') loadEnv()
    }, [connStatus])

    // 订阅安装进度
    useEffect(() => {
        const unsub = window.ipc.onInstallProgress(({step, status, detail}) => {
            setInstall((prev) => {
                const prevStep = prev.steps[step as InstallStep]
                if (!prevStep) return prev
                const newLogs = status === 'running' && detail
                    ? [...(prevStep.logs).slice(-199), detail]
                    : prevStep.logs
                return {
                    ...prev,
                    steps: {
                        ...prev.steps,
                        [step]: {status: status as 'running' | 'done' | 'error', detail, logs: newLogs}
                    },
                }
            })
        })
        return () => { unsub() }
    }, [])

    // 订阅 Gateway 进程实时日志
    useEffect(() => {
        const unsub = window.ipc.onGatewayLog(({ line, isError }) => {
            setGwLogs(prev => [...prev.slice(-499), { line, isError }])
        })
        return () => { unsub() }
    }, [])

    // 挂载时拉取 gateway 日志快照
    useEffect(() => {
        window.ipc.gatewayLogsGet().then((logs) => {
            const ls = logs as Array<{ line: string; isError: boolean }>
            if (ls.length > 0) setGwLogs(ls)
        }).catch(() => {})
    }, [])

    const handleStart = async () => {
        setInstall({running: true, steps: EMPTY_STEPS()})
        await window.ipc.envInstallOpenclaw()
        setInstall((prev) => ({...prev, running: false}))
        loadEnv()
    }

    const handleSwitchToBundled = async () => {
        setSwitchingToBundled(true)
        try {
            const res = await window.ipc.gatewayResolveConflict('stop-and-start')
            const r = res as { ok: boolean; error?: string }
            if (r.ok) {
                toast.success('已切换至内置 OpenClaw')
                loadEnv()
            } else {
                toast.error(r.error ?? '切换失败')
            }
        } catch {
            toast.error('切换失败')
        } finally {
            setSwitchingToBundled(false)
        }
    }

    const sourceLabel = env?.openclaw.activeSource === 'system' ? '系统'
        : env?.openclaw.activeSource === 'external' ? '外部直连' : '内置'

    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-muted/20">
            {/* Page Header */}
            <div className="shrink-0 flex items-center px-8 py-5 border-b bg-background"
                 style={{WebkitAppRegion: "drag", ...(window.ipc.platform !== 'darwin' ? {paddingRight: '154px'} : {})} as React.CSSProperties}>
                <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 shrink-0"
                     style={{WebkitAppRegion: "no-drag"} as React.CSSProperties}>
                    <Activity className="h-5 w-5 text-primary"/>
                </div>
                <div className="ml-3" style={{WebkitAppRegion: "no-drag"} as React.CSSProperties}>
                    <h1 className="text-lg font-semibold">{t("openclawPanel.title")}</h1>
                    <p className="text-xs text-muted-foreground">OpenClaw 网关状态与运行日志</p>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
                <div className="max-w-4xl mx-auto space-y-6">

                    {/* Status Card — 合并 OpenClaw 信息 + 连接状态 */}
                    <Card className="p-5">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                    <span className="text-lg leading-none select-none">🦞</span>
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-semibold">
                                            OpenClaw {!envLoading && env?.openclaw.version ? `v${env.openclaw.version}` : ''}
                                        </p>
                                        {!envLoading && env && (
                                            <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">
                                                {sourceLabel}
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {envLoading ? "检测中..." : (
                                            connStatus === "connected"
                                                ? `${state.agents.length} 个 Agent 已就绪`
                                                : connStatus === "connecting"
                                                    ? "正在连接网关..."
                                                    : "未连接到 OpenClaw 网关"
                                        )}
                                    </p>
                                </div>
                            </div>

                            {/* 连接状态 pill */}
                            <div className={cn(
                                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs shrink-0",
                                connStatus === "connected"
                                    ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
                                    : connStatus === "connecting"
                                        ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-400"
                                        : "bg-muted text-muted-foreground"
                            )}>
                                {connStatus === "connecting" ? (
                                    <Loader2 className="h-3 w-3 animate-spin"/>
                                ) : connStatus === "connected" ? (
                                    <Wifi className="h-3 w-3"/>
                                ) : (
                                    <WifiOff className="h-3 w-3"/>
                                )}
                                {connStatus === "connected" ? "已连接" :
                                    connStatus === "connecting" ? "连接中" : "未连接"}
                            </div>
                        </div>

                        {/* Gateway URL + 控制台链接 */}
                        {gatewayUrl && (
                            <>
                                <Separator className="my-4 opacity-50"/>
                                <div className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                        <Server className="h-3 w-3"/>
                                        <span className="font-mono">{gatewayUrl}</span>
                                    </div>
                                    {consoleUrl && (
                                        <a
                                            href={consoleUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1 text-primary hover:underline shrink-0"
                                        >
                                            <ExternalLink className="h-3 w-3"/>
                                            打开控制台
                                        </a>
                                    )}
                                </div>
                            </>
                        )}

                        {/* 外部直连模式警告 */}
                        {!envLoading && env?.openclaw.activeSource === 'external' && (
                            <>
                                <Separator className="my-4"/>
                                <div className="rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900/50 dark:bg-orange-950/20 p-4">
                                    <div className="flex items-start gap-3">
                                        <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0"/>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-orange-800 dark:text-orange-300">正在使用外部直连模式</p>
                                            <p className="text-xs text-orange-600 dark:text-orange-400/80 mt-1">
                                                当前连接到外部 OpenClaw 实例，切换至内置可获得更稳定的体验。
                                            </p>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="mt-3 border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-950/50"
                                                onClick={handleSwitchToBundled}
                                                disabled={switchingToBundled}
                                            >
                                                {switchingToBundled ? (
                                                    <><Loader2 className="h-3 w-3 animate-spin mr-1.5"/>切换中...</>
                                                ) : (
                                                    <><Package className="h-3 w-3 mr-1.5"/>切换至内置 OpenClaw</>
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* 启动面板 */}
                        {!envLoading && env && !env.openclaw.running && env.openclaw.canStart && env.openclaw.activeSource === 'bundled' && (
                            <>
                                <Separator className="my-4"/>
                                <StartPanel install={install} onStart={handleStart}/>
                            </>
                        )}
                    </Card>

                    {/* Gateway 进程实时日志 */}
                    <GatewayLogCard logs={gwLogs} onClear={() => setGwLogs([])}/>

                </div>
            </div>
        </div>
    )
}

// ── 启动面板 ──────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
    node: 'Node.js 环境',
    init: '初始化配置',
    start: '启动 Gateway',
    connect: '连接网关',
}

function StartPanel({install, onStart}: { install: InstallState; onStart: () => void }) {
    const hasError = Object.values(install.steps).some((s) => s.status === 'error')
    const isDone = install.steps.connect.status === 'done'
    const [logOpen, setLogOpen] = useState(false)

    useEffect(() => {
        if (hasError) setLogOpen(true)
    }, [hasError])

    const allLogs = (Object.entries(install.steps) as [string, InstallState['steps'][InstallStep]][])
        .flatMap(([key, step]) => step.logs.map((l) => `[${STEP_LABELS[key] ?? key}] ${l}`))

    return (
        <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-medium">启动内置 OpenClaw Gateway</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Gateway 未运行，点击启动按钮重新启动内置 Gateway
                    </p>
                </div>
                <Button
                    size="sm"
                    onClick={onStart}
                    disabled={install.running || isDone}
                    className="shrink-0 gap-1.5"
                >
                    {install.running ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin"/>
                    ) : (
                        <PlayCircle className="h-3.5 w-3.5"/>
                    )}
                    {isDone ? '已启动' : install.running ? '启动中...' : '启动 Gateway'}
                </Button>
            </div>

            {(install.running || hasError || isDone) && (
                <div className="space-y-1.5 pt-1">
                    {(Object.entries(install.steps) as [string, InstallState['steps'][InstallStep]][]).map(([key, step]) => (
                        <div key={key} className="flex items-center gap-2 text-xs">
                            {step.status === 'pending' && (
                                <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/30"/>
                            )}
                            {step.status === 'running' && (
                                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary"/>
                            )}
                            {step.status === 'done' && (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500"/>
                            )}
                            {step.status === 'error' && (
                                <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive"/>
                            )}
                            <span className={cn(
                                "font-medium shrink-0",
                                step.status === 'error' && "text-destructive",
                                step.status === 'done' && "text-green-600 dark:text-green-400",
                                step.status === 'pending' && "text-muted-foreground",
                            )}>
                                {STEP_LABELS[key] ?? key}
                            </span>
                            {step.status !== 'running' && step.detail && (
                                <span className={cn(
                                    "truncate",
                                    step.status === 'error' ? "text-destructive/80" : "text-muted-foreground"
                                )}>{step.detail}</span>
                            )}
                            {step.status === 'running' && step.logs.length > 0 && (
                                <span className="text-muted-foreground truncate">{step.logs[step.logs.length - 1]}</span>
                            )}
                        </div>
                    ))}

                    {allLogs.length > 0 && (
                        <div className="pt-1">
                            <button
                                onClick={() => setLogOpen((v) => !v)}
                                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <span className={cn("transition-transform", logOpen ? "rotate-90" : "")}>▶</span>
                                {logOpen ? '收起' : '查看'}启动日志 ({allLogs.length} 行)
                            </button>
                            {logOpen && <LogViewer lines={allLogs}/>}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ── Gateway 日志卡片 ────────────────────────────────────────────────────────

function GatewayLogCard({ logs, onClear }: {
    logs: Array<{ line: string; isError: boolean }>
    onClear: () => void
}) {
    // 有日志时默认展开，让用户立即看到连接进度
    const [open, setOpen] = useState(logs.length > 0)
    const ref = React.useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (logs.length > 0 && !open) setOpen(true)
    }, [logs.length, open])

    useEffect(() => {
        if (open && ref.current) {
            ref.current.scrollTop = ref.current.scrollHeight
        }
    }, [open, logs.length])

    return (
        <Card className="p-5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold">Gateway 运行日志</h2>
                    {logs.length > 0 && (
                        <span className="text-xs text-muted-foreground">({logs.length} 行)</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {logs.length > 0 && (
                        <button
                            onClick={onClear}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5"
                        >
                            清空
                        </button>
                    )}
                    <button
                        onClick={() => setOpen(v => !v)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5"
                    >
                        {open ? '收起' : '展开'}
                    </button>
                </div>
            </div>
            {!open && logs.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                    Gateway 进程启动后此处将显示实时输出
                </p>
            )}
            {!open && logs.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1 truncate">
                    {logs[logs.length - 1].line}
                </p>
            )}
            {open && (
                <div
                    ref={ref}
                    className="mt-3 h-48 overflow-y-auto rounded-md bg-black/80 p-2 text-[10px] font-mono leading-relaxed"
                >
                    {logs.slice(-500).map((entry, i) => (
                        <div
                            key={i}
                            className={cn(
                                "whitespace-pre-wrap break-all",
                                entry.isError ? "text-red-400" : "text-green-300/90"
                            )}
                        >
                            {entry.line}
                        </div>
                    ))}
                </div>
            )}
        </Card>
    )
}

// ── 日志查看器 ──────────────────────────────────────────────────────────────

function LogViewer({lines}: { lines: string[] }) {
    const ref = React.useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (ref.current) {
            ref.current.scrollTop = ref.current.scrollHeight
        }
    }, [lines.length])

    return (
        <div
            ref={ref}
            className="mt-1.5 h-40 overflow-y-auto rounded-md bg-black/80 p-2 text-[10px] font-mono leading-relaxed"
        >
            {lines.map((line, i) => (
                <div key={i} className={cn(
                    "whitespace-pre-wrap break-all",
                    line.includes('error') || line.includes('Error') || line.includes('ERR') || line.includes('失败')
                        ? "text-red-400"
                        : line.includes('warn') || line.includes('WARN')
                            ? "text-yellow-400"
                            : "text-green-300/90"
                )}>
                    {line}
                </div>
            ))}
        </div>
    )
}
