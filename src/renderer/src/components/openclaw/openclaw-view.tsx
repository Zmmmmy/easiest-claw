import React, {useEffect, useState} from "react"
import {
    Activity,
    AlertTriangle,
    ArrowUpCircle,
    CheckCircle2,
    ExternalLink,
    Eye,
    EyeOff,
    Info,
    KeyRound,
    Loader2,
    Monitor,
    Package,
    PlayCircle,
    RefreshCw,
    Save,
    Server,
    Star,
    Wifi,
    WifiOff,
    XCircle,
    Zap,
} from "lucide-react"
import {toast} from "sonner"
import {Avatar, AvatarFallback, AvatarImage} from "@/components/ui/avatar"
import {Badge} from "@/components/ui/badge"
import {Button} from "@/components/ui/button"
import {Card} from "@/components/ui/card"
import {Input} from "@/components/ui/input"
import {Separator} from "@/components/ui/separator"
import {useI18n} from "@/i18n"
import {getAgentAvatarUrl} from "@/lib/avatar"
import {cn} from "@/lib/utils"
import {useApp} from "@/store/app-context"

const connColors: Record<string, { ring: string; bg: string; text: string; dot: string }> = {
    connected: {
        ring: "ring-green-500/30",
        bg: "bg-green-50 dark:bg-green-950/30",
        text: "text-green-700 dark:text-green-400",
        dot: "bg-green-500"
    },
    connecting: {
        ring: "ring-yellow-500/30",
        bg: "bg-yellow-50 dark:bg-yellow-950/30",
        text: "text-yellow-700 dark:text-yellow-400",
        dot: "bg-yellow-500"
    },
    disconnected: {
        ring: "ring-border",
        bg: "bg-muted/40",
        text: "text-muted-foreground",
        dot: "bg-muted-foreground/50"
    },
    error: {ring: "ring-destructive/30", bg: "bg-destructive/5", text: "text-destructive", dot: "bg-destructive"},
}

const agentStatusDot: Record<string, string> = {
    idle: "bg-muted-foreground/40",
    working: "bg-blue-500",
    busy: "bg-orange-500",
    chatting: "bg-green-500",
    thinking: "bg-purple-500",
    completed: "bg-green-600",
}

const agentStatusLabel: Record<string, string> = {
    idle: "空闲",
    working: "工作中",
    busy: "忙碌",
    chatting: "聊天中",
    thinking: "思考中",
    completed: "已完成",
}

interface SystemNodeInfo {
    available: boolean
    version: string
    path?: string | null
    satisfies: boolean
}

interface SystemOpenclawInfo {
    available: boolean
    version?: string
    running: boolean
    port: number
    token: string | null
    path?: string | null
}

interface EnvInfo {
    os: { platform: string; name: string; release: string; arch: string }
    node: {
        version: string
        activeSource: 'system' | 'bundled'
        activeReason: string
        system: SystemNodeInfo | null
        bundled: { available: boolean; version: string }
    }
    openclaw: {
        version?: string
        running: boolean
        canStart: boolean
        system: SystemOpenclawInfo | null
        bundled: { available: boolean; version?: string; path?: string | null }
        activeSource: 'system' | 'bundled' | 'external'
        activeReason: string
    }
}

interface UpdateInfo {
    current: string | null
    latest: string | null
    hasUpdate: boolean
}

type UpgradeStep = 'stop' | 'download' | 'install' | 'start'

interface UpgradeState {
    running: boolean
    steps: Record<UpgradeStep, { status: 'pending' | 'running' | 'done' | 'error'; logs: string[] }>
}

const EMPTY_UPGRADE_STEPS = (): UpgradeState['steps'] => ({
    stop: { status: 'pending', logs: [] },
    download: { status: 'pending', logs: [] },
    install: { status: 'pending', logs: [] },
    start: { status: 'pending', logs: [] },
})

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
    const {state, refreshFleet} = useApp()
    const {t} = useI18n()
    const [refreshing, setRefreshing] = useState(false)
    const [gatewayUrl, setGatewayUrl] = useState<string | null>(null)
    const [hasToken, setHasToken] = useState(false)
    const [consoleUrl, setConsoleUrl] = useState<string | null>(null)
    const [env, setEnv] = useState<EnvInfo | null>(null)
    const [envLoading, setEnvLoading] = useState(true)
    const [install, setInstall] = useState<InstallState>({running: false, steps: EMPTY_STEPS()})
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
    const [checking, setChecking] = useState(false)
    const [upgrade, setUpgrade] = useState<UpgradeState>({running: false, steps: EMPTY_UPGRADE_STEPS()})
    const [switchingToBundled, setSwitchingToBundled] = useState(false)
    const [gwLogs, setGwLogs] = useState<Array<{ line: string; isError: boolean }>>([])

    const connStatus = state.connectionStatus ?? "disconnected"
    const colors = connColors[connStatus] ?? connColors.disconnected

    const connectionLabels: Record<string, string> = {
        connected: t("topNav.connection.connected"),
        connecting: t("topNav.connection.connecting"),
        disconnected: t("topNav.connection.disconnected"),
        error: t("topNav.connection.error"),
    }

    useEffect(() => {
        window.ipc.settingsGetFull().then((res) => {
            const s = res as { gateway?: { url?: string; token?: string } | null }
            const gw = s?.gateway
            const url = gw?.url ?? null
            const token = gw?.token ?? null
            setGatewayUrl(url)
            setHasToken(Boolean(token))
            if (url && token) {
                const httpUrl = url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
                setConsoleUrl(`${httpUrl}/?token=${encodeURIComponent(token)}`)
            }
        }).catch(() => {
        })
    }, [])

    const loadEnv = () => {
        setEnvLoading(true)
        window.ipc.envDetect().then((res) => {
            const r = res as { ok: boolean; result?: EnvInfo }
            if (r.ok && r.result) {
                setEnv(r.result)
                // env 加载后用本地版本初始化，不需要用户手动点检查更新才显示版本号
                if (r.result.openclaw.version) {
                    setUpdateInfo((prev) => prev
                        ? {...prev, current: r.result!.openclaw.version!}
                        : {current: r.result!.openclaw.version!, latest: null, hasUpdate: false}
                    )
                }
            }
        }).catch(() => {
        }).finally(() => setEnvLoading(false))
    }

    useEffect(() => {
        loadEnv()
    }, [])

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

    const handleStart = async () => {
        setInstall({running: true, steps: EMPTY_STEPS()})
        await window.ipc.envInstallOpenclaw()
        setInstall((prev) => ({...prev, running: false}))
        loadEnv()
    }

    const handleRefresh = async () => {
        setRefreshing(true)
        await Promise.all([refreshFleet(), new Promise<void>(res => {
            loadEnv();
            res()
        })])
        setRefreshing(false)
    }

    // 订阅升级进度
    useEffect(() => {
        const unsub = window.ipc.onUpgradeProgress(({step, status, detail}) => {
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
                        [step]: {status: status as 'running' | 'done' | 'error', logs: newLogs}
                    }
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

    // 挂载时从主进程拉取快照，恢复切换页面后丢失的状态
    useEffect(() => {
        window.ipc.openclawUpgradeStateGet().then((s) => {
            const state = s as { running: boolean; steps: Record<string, { status: string; logs: string[] }> }
            if (state.running || Object.values(state.steps).some(v => v.status !== 'pending')) {
                const pick = (key: string) => (state.steps[key] ?? { status: 'pending', logs: [] }) as { status: 'pending' | 'running' | 'done' | 'error'; logs: string[] }
                setUpgrade({ running: state.running, steps: { stop: pick('stop'), download: pick('download'), install: pick('install'), start: pick('start') } })
            }
        }).catch(() => {})
        window.ipc.gatewayLogsGet().then((logs) => {
            const ls = logs as Array<{ line: string; isError: boolean }>
            if (ls.length > 0) setGwLogs(ls)
        }).catch(() => {})
    }, [])

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
        setUpgrade({running: true, steps: EMPTY_UPGRADE_STEPS()})
        try {
            const res = await window.ipc.openclawUpgrade(version)
            const r = res as { ok: boolean; error?: string }
            if (r.ok) {
                toast.success(`升级成功，当前版本 ${version}`)
                setUpdateInfo(prev => prev ? {...prev, hasUpdate: false, current: version} : null)
                loadEnv()
            } else {
                toast.error(r.error ?? '升级失败')
            }
        } catch {
            toast.error('升级失败')
        } finally {
            setUpgrade((prev) => ({...prev, running: false}))
        }
    }

    const mainAgent = state.agents.find((a) => a.id === state.mainAgentId)
    const otherAgents = state.agents.filter((a) => a.id !== state.mainAgentId)
    const workingCount = state.agents.filter((a) => a.status !== "idle").length

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
                    <div className="flex items-center gap-1">
                        <h1 className="text-lg font-semibold">{t("openclawPanel.title")}</h1>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="h-6 w-6 text-muted-foreground/50 hover:text-foreground"
                            title="刷新"
                        >
                            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")}/>
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">OpenClaw 网关连接与 Agent 舰队管理</p>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
                <div className="max-w-4xl mx-auto space-y-6">

                    {/* Environment Detection Card */}
                    <Card className="p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <Monitor className="h-4 w-4 text-muted-foreground"/>
                            <h2 className="text-sm font-semibold">运行环境</h2>
                            {envLoading &&
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto"/>}
                        </div>
                        <div className="space-y-3">
                            {/* OS */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                    <div
                                        className="h-7 w-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                                        <span className="text-xs font-mono text-muted-foreground">OS</span>
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium">操作系统</p>
                                        <p className="text-xs text-muted-foreground">
                                            {env ? `${env.os.name} · ${env.os.arch}` : "检测中..."}
                                        </p>
                                    </div>
                                </div>
                                {env && (
                                    <Badge variant="secondary" className="text-xs font-normal shrink-0">
                                        {env.os.release.split('.').slice(0, 2).join('.')}
                                    </Badge>
                                )}
                            </div>

                            <Separator/>

                            {/* Node.js */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <div
                                            className="h-7 w-7 rounded-md bg-green-100 dark:bg-green-950/50 flex items-center justify-center shrink-0">
                                            <span
                                                className="text-[10px] font-bold text-green-700 dark:text-green-400">JS</span>
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium">Node.js</p>
                                            <p className="text-xs text-muted-foreground">
                                                {envLoading ? "检测中..." : env?.node.version ?? ""}
                                            </p>
                                            {!envLoading && env?.node.activeSource === 'system' && env.node.system?.path && (
                                                <p className="text-[10px] font-mono text-muted-foreground/60 truncate max-w-56"
                                                   title={env.node.system.path}>{env.node.system.path}</p>
                                            )}
                                        </div>
                                    </div>
                                    {!envLoading && env && (
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <CheckCircle2 className="h-4 w-4 text-green-500"/>
                                            <span className="text-xs text-green-600 dark:text-green-400">
                                                {env.node.activeSource === 'system' ? '系统' : '内置 (Electron)'}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* 自动选择原因说明 */}
                                {!envLoading && env && (
                                    <div className="ml-9 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                                        <Info className="h-3 w-3 shrink-0"/>
                                        <span>{env.node.activeReason}</span>
                                    </div>
                                )}
                            </div>

                            <Separator/>

                            {/* OpenClaw */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                                            <span className="text-base leading-none select-none">🦞</span>
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium">OpenClaw</p>
                                            <p className="text-xs text-muted-foreground">
                                                {envLoading ? "检测中..." : (
                                                    env?.openclaw.version ?? (env?.openclaw.canStart ? "已安装" : "未安装")
                                                )}
                                            </p>
                                            {!envLoading && env && (() => {
                                                const activePath = env.openclaw.activeSource === 'system'
                                                    ? env.openclaw.system?.path
                                                    : env.openclaw.bundled.path
                                                return activePath ? (
                                                    <p className="text-[10px] font-mono text-muted-foreground/60 truncate max-w-56"
                                                       title={activePath}>{activePath}</p>
                                                ) : null
                                            })()}
                                        </div>
                                    </div>
                                    {/* 右侧：运行状态 + 来源 */}
                                    {!envLoading && env && (
                                        <div className="flex items-center gap-2 shrink-0">
                                            <div className={cn(
                                                "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs",
                                                connStatus === "connected"
                                                    ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
                                                    : connStatus === "connecting"
                                                        ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-400"
                                                        : "bg-muted text-muted-foreground"
                                            )}>
                                                <span className={cn(
                                                    "h-1.5 w-1.5 rounded-full",
                                                    connStatus === "connected" ? "bg-green-500" :
                                                        connStatus === "connecting" ? "bg-yellow-500 animate-pulse" :
                                                            "bg-muted-foreground/50"
                                                )}/>
                                                {connStatus === "connected" ? "运行中" :
                                                    connStatus === "connecting" ? "连接中" : "未运行"}
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <CheckCircle2 className="h-4 w-4 text-green-500"/>
                                                <span className="text-xs text-green-600 dark:text-green-400">
                                                    {env.openclaw.activeSource === 'system' ? '系统' : env.openclaw.activeSource === 'external' ? '外部直连' : '内置'}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* 自动选择原因说明 */}
                                {!envLoading && env && (
                                    <div className="ml-9 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                                        <Info className="h-3 w-3 shrink-0"/>
                                        <span>{env.openclaw.activeReason}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 外部直连模式警告：引导用户切换至内置 */}
                        {!envLoading && env?.openclaw.activeSource === 'external' && (
                            <>
                                <Separator className="my-4"/>
                                <div className="rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900/50 dark:bg-orange-950/20 p-4">
                                    <div className="flex items-start gap-3">
                                        <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0"/>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-orange-800 dark:text-orange-300">正在使用外部直连模式</p>
                                            <p className="text-xs text-orange-600 dark:text-orange-400/80 mt-1">
                                                当前连接到外部 OpenClaw 实例，而非应用内置版本。切换至内置可获得更稳定的体验，且无需依赖外部进程。
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

                        {/* 启动面板：内置模式下 gateway 未运行时显示 */}
                        {!envLoading && env && !env.openclaw.running && env.openclaw.canStart && env.openclaw.activeSource === 'bundled' && (
                            <>
                                <Separator className="my-4"/>
                                <StartPanel
                                    install={install}
                                    onStart={handleStart}
                                />
                            </>
                        )}
                    </Card>

                    {/* Version & Update Card */}
                    {!envLoading && env?.openclaw.canStart && (
                        <VersionCard
                            updateInfo={updateInfo}
                            checking={checking}
                            upgrade={upgrade}
                            envLoading={envLoading}
                            activeSource={env.openclaw.activeSource}
                            onCheckUpdate={handleCheckUpdate}
                            onUpgrade={handleUpgrade}
                        />
                    )}

                    {/* Connection Status Card */}
                    <Card className={cn("p-5 ring-1", colors.ring, colors.bg)}>
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div
                                    className={cn("flex items-center justify-center h-10 w-10 rounded-full", colors.bg, "ring-1", colors.ring)}>
                                    {connStatus === "connecting" ? (
                                        <Loader2 className={cn("h-5 w-5 animate-spin", colors.text)}/>
                                    ) : connStatus === "connected" ? (
                                        <Wifi className={cn("h-5 w-5", colors.text)}/>
                                    ) : (
                                        <WifiOff className={cn("h-5 w-5", colors.text)}/>
                                    )}
                                </div>
                                <div>
                                    <p className={cn("text-sm font-semibold", colors.text)}>
                                        {connectionLabels[connStatus] ?? connectionLabels.disconnected}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {connStatus === "connected"
                                            ? `${state.agents.length} 个 Agent 已就绪`
                                            : "未连接到 OpenClaw 网关"}
                                    </p>
                                </div>
                            </div>
                            <span
                                className={cn("mt-1 h-2.5 w-2.5 rounded-full shrink-0", colors.dot, connStatus === "connecting" && "animate-pulse")}/>
                        </div>

                        {gatewayUrl && (
                            <>
                                <Separator className="my-4 opacity-50"/>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="space-y-1">
                                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                            <Server className="h-3 w-3 inline mr-1"/>
                                            {t("openclawPanel.gateway")}
                                        </p>
                                        <p className="font-mono text-xs truncate">{gatewayUrl}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                            <KeyRound className="h-3 w-3 inline mr-1"/>
                                            {t("openclawPanel.token")}
                                        </p>
                                        <div className="flex items-center gap-1.5">
                                            {hasToken ? (
                                                <>
                                                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600"/>
                                                    <span
                                                        className="text-xs text-green-700 dark:text-green-400">{t("openclawPanel.tokenSet")}</span>
                                                </>
                                            ) : (
                                                <>
                                                    <XCircle className="h-3.5 w-3.5 text-muted-foreground"/>
                                                    <span
                                                        className="text-xs text-muted-foreground">{t("openclawPanel.tokenNone")}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                {consoleUrl && (
                                    <>
                                        <Separator className="my-3 opacity-50"/>
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                                                    <ExternalLink className="h-3 w-3 inline mr-1"/>
                                                    控制台
                                                </p>
                                                <p className="text-[11px] text-muted-foreground">浏览器直接打开，无需手动填写
                                                    Token</p>
                                            </div>
                                            <a
                                                href={consoleUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
                                            >
                                                <ExternalLink className="h-3 w-3"/>
                                                打开控制台
                                            </a>
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </Card>

                    {/* Gateway 配置卡片 */}
                    <GatewayConfigCard onSaved={handleRefresh}/>

                    {/* Gateway 进程实时日志 */}
                    <GatewayLogCard logs={gwLogs} onClear={() => setGwLogs([])}/>

                    {/* Agent Fleet */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-sm font-semibold">{t("openclawPanel.agents")}</h2>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    共 {state.agents.length} 个 Agent
                                    {workingCount > 0 && `，${workingCount} 个正在工作`}
                                </p>
                            </div>
                        </div>

                        {state.agents.length === 0 ? (
                            <Card className={cn(
                                "p-8 text-center",
                                connStatus === "connected" && "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20"
                            )}>
                                <Server className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3"/>
                                {connStatus === "connected" ? (
                                    <>
                                        <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-1">
                                            未找到 AI 提供商配置
                                        </p>
                                        <p className="text-xs text-muted-foreground mb-3">
                                            需要在设置中添加 AI 模型提供商（如 Claude、OpenAI 等）并填写 API Key，Agent
                                            才能正常运行
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            点击左侧导航栏底部的 <kbd
                                            className="px-1 py-0.5 rounded bg-muted text-xs font-mono">Settings</kbd> 图标
                                            → AI Models → 添加提供商
                                        </p>
                                    </>
                                ) : (
                                    <p className="text-sm text-muted-foreground">{t("openclawPanel.noAgents")}</p>
                                )}
                            </Card>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {mainAgent && (
                                    <AgentCard agent={mainAgent} isMain/>
                                )}
                                {otherAgents.map((agent) => (
                                    <AgentCard key={agent.id} agent={agent}/>
                                ))}
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </div>
    )
}

interface AgentCardProps {
    agent: {
        id: string
        name: string
        role: string
        avatar: string
        skills: string[]
        status: string
        currentTask?: string
    }
    isMain?: boolean
}

function AgentCard({agent, isMain}: AgentCardProps) {
    const dot = agentStatusDot[agent.status] ?? "bg-muted-foreground/40"
    const statusLabel = agentStatusLabel[agent.status] ?? agent.status

    return (
        <Card className={cn(
            "p-4 flex flex-col gap-3 transition-colors",
            isMain && "ring-1 ring-primary/30 bg-primary/5"
        )}>
            <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                    <Avatar className="h-10 w-10">
                        <AvatarImage src={getAgentAvatarUrl(agent.id)} alt={agent.name}/>
                        <AvatarFallback className="text-xs bg-blue-100 text-blue-700">
                            {agent.avatar}
                        </AvatarFallback>
                    </Avatar>
                    <span className={cn(
                        "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background",
                        dot
                    )}/>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{agent.name}</span>
                        {isMain && <Star className="h-3.5 w-3.5 text-primary shrink-0"/>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{agent.role}</p>
                </div>
                <Badge
                    variant={agent.status === "idle" ? "outline" : "secondary"}
                    className={cn(
                        "text-[10px] h-5 px-1.5 shrink-0",
                        agent.status === "working" && "bg-blue-100 text-blue-700 border-blue-200",
                        agent.status === "thinking" && "bg-purple-100 text-purple-700 border-purple-200",
                        agent.status === "busy" && "bg-orange-100 text-orange-700 border-orange-200",
                    )}
                >
                    {statusLabel}
                </Badge>
            </div>

            {agent.skills.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {agent.skills.slice(0, 3).map((skill) => (
                        <span
                            key={skill}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground"
                        >
              {skill}
            </span>
                    ))}
                    {agent.skills.length > 3 && (
                        <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
              +{agent.skills.length - 3}
            </span>
                    )}
                </div>
            )}

            {agent.currentTask && (
                <p className="text-[11px] text-muted-foreground truncate border-t pt-2">
                    {agent.currentTask}
                </p>
            )}
        </Card>
    )
}

// ── 版本更新卡片 ──────────────────────────────────────────────────────────────

interface VersionCardProps {
    updateInfo: UpdateInfo | null
    checking: boolean
    upgrade: UpgradeState
    envLoading: boolean
    activeSource: 'system' | 'bundled' | 'external'
    onCheckUpdate: () => void
    onUpgrade: (version: string) => void
}

function VersionCard({updateInfo, checking, upgrade, envLoading, activeSource, onCheckUpdate, onUpgrade}: VersionCardProps) {
    const upgradeStepLabels: Record<UpgradeStep, string> = {
        stop: '停止 Gateway',
        download: activeSource === 'system' ? '全局更新 (npm -g)' : '下载新版本',
        install: activeSource === 'system' ? '' : '安装文件',
        start: '重启 Gateway',
    }

    const visibleSteps = (Object.entries(upgrade.steps) as [UpgradeStep, { status: string; logs: string[] }][])
        .filter(([step]) => activeSource !== 'system' || step !== 'install')

    const allLogs = (Object.entries(upgrade.steps) as [UpgradeStep, { status: string; logs: string[] }][])
        .flatMap(([, s]) => s.logs)

    const hasUpgradeError = Object.values(upgrade.steps).some(s => s.status === 'error')

    return (
        <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
                <Package className="h-4 w-4 text-muted-foreground"/>
                <h2 className="text-sm font-semibold">版本管理</h2>
                <span className={cn(
                    "ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                    activeSource === 'system'
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400"
                        : activeSource === 'external'
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                            : "bg-muted text-muted-foreground"
                )}>
                    {activeSource === 'system' ? '系统' : activeSource === 'external' ? '外部直连' : '内置'}
                </span>
                {activeSource === 'system' && (
                    <span className="ml-auto text-[10px] text-muted-foreground/70 flex items-center gap-1">
                        <Info className="h-3 w-3"/>
                        升级将执行 npm install -g
                    </span>
                )}
            </div>

            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-base leading-none select-none">🦞</span>
                    </div>
                    <div>
                        <p className="text-sm font-medium">OpenClaw</p>
                        <p className="text-xs text-muted-foreground">
                            当前版本：{updateInfo?.current ?? (envLoading ? '读取中...' : '未知')}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {updateInfo?.hasUpdate && updateInfo.latest && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <ArrowUpCircle className="h-3.5 w-3.5"/>
                            可升级至 {updateInfo.latest}
                        </span>
                    )}
                    {updateInfo && !updateInfo.hasUpdate && updateInfo.latest && (
                        <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5"/>
                            已是最新
                        </span>
                    )}
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onCheckUpdate}
                        disabled={checking || upgrade.running}
                        className="h-7 text-xs"
                    >
                        {checking
                            ? <><Loader2 className="h-3 w-3 mr-1 animate-spin"/>检查中</>
                            : <><RefreshCw className="h-3 w-3 mr-1"/>检查更新</>
                        }
                    </Button>
                    {updateInfo?.hasUpdate && updateInfo.latest && (
                        <Button
                            size="sm"
                            onClick={() => onUpgrade(updateInfo.latest!)}
                            disabled={upgrade.running}
                            className="h-7 text-xs"
                        >
                            {upgrade.running
                                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin"/>升级中</>
                                : <><Zap className="h-3 w-3 mr-1"/>立即升级</>
                            }
                        </Button>
                    )}
                </div>
            </div>

            {/* 升级进度 */}
            {(upgrade.running || hasUpgradeError) && (
                <>
                    <Separator className="my-4"/>
                    <div className="space-y-2">
                        <div className="flex gap-4 text-xs text-muted-foreground mb-3">
                            {visibleSteps.map(([step, s]) => (
                                <div key={step} className="flex items-center gap-1">
                                    {s.status === 'done'
                                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500"/>
                                        : s.status === 'running'
                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500"/>
                                            : s.status === 'error'
                                                ? <XCircle className="h-3.5 w-3.5 text-destructive"/>
                                                : <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30"/>
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
        </Card>
    )
}

// ── 网关配置卡片 ──────────────────────────────────────────────────────────────

function GatewayConfigCard({onSaved}: { onSaved?: () => void }) {
    const [url, setUrl] = useState('')
    const [token, setToken] = useState('')
    const [showToken, setShowToken] = useState(false)
    const [saving, setSaving] = useState(false)
    const [detecting, setDetecting] = useState(false)

    // 加载现有配置
    useEffect(() => {
        window.ipc.settingsGetFull().then((res) => {
            const s = res as { gateway?: { url?: string; token?: string } | null }
            setUrl(s?.gateway?.url ?? '')
            setToken(s?.gateway?.token ?? '')
        }).catch(() => {
        })
    }, [])

    const handleDetect = async () => {
        setDetecting(true)
        try {
            const res = await window.ipc.settingsDetectLocal()
            const detected = res as { url?: string; token?: string } | null
            if (detected?.url) {
                setUrl(detected.url)
                setToken(detected.token ?? '')
                toast.success('已自动检测到本地配置')
            } else {
                toast.info('未检测到本地 openclaw 配置')
            }
        } catch {
            toast.error('检测失败')
        } finally {
            setDetecting(false)
        }
    }

    const handleSave = async () => {
        if (!url.trim()) {
            toast.error('请填写访问地址')
            return
        }
        if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
            toast.error('地址格式有误，应以 ws:// 或 wss:// 开头')
            return
        }
        setSaving(true)
        try {
            const res = await window.ipc.settingsSaveGateway({url: url.trim(), token: token.trim()})
            const r = res as { ok: boolean; error?: string }
            if (r.ok) {
                toast.success('配置已保存，正在重新连接...')
                onSaved?.()
            } else {
                toast.error(r.error ?? '保存失败')
            }
        } catch {
            toast.error('保存失败')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
                <Server className="h-4 w-4 text-muted-foreground"/>
                <h2 className="text-sm font-semibold">网关连接配置</h2>
            </div>

            <div className="space-y-3">
                {/* URL */}
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">访问地址</label>
                    <Input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="ws://localhost:18789"
                        className="h-8 text-sm font-mono"
                    />
                </div>

                {/* Token */}
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">访问 Token</label>
                    <div className="relative">
                        <Input
                            type={showToken ? 'text' : 'password'}
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            placeholder="留空表示无认证"
                            className="h-8 text-sm font-mono pr-9"
                        />
                        <button
                            type="button"
                            onClick={() => setShowToken((v) => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                        >
                            {showToken
                                ? <EyeOff className="h-3.5 w-3.5"/>
                                : <Eye className="h-3.5 w-3.5"/>
                            }
                        </button>
                    </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-2 pt-1">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDetect}
                        disabled={detecting || saving}
                        className="gap-1.5 text-xs h-7"
                    >
                        {detecting
                            ? <Loader2 className="h-3 w-3 animate-spin"/>
                            : <Zap className="h-3 w-3"/>
                        }
                        自动检测
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={saving || detecting}
                        className="gap-1.5 text-xs h-7 ml-auto"
                    >
                        {saving
                            ? <Loader2 className="h-3 w-3 animate-spin"/>
                            : <Save className="h-3 w-3"/>
                        }
                        保存并连接
                    </Button>
                </div>

                <p className="text-[11px] text-muted-foreground">
                    "自动检测"读取本地 <code
                    className="text-[10px] bg-muted px-1 py-0.5 rounded">~/.openclaw/openclaw.json</code>；也可手动填写远程网关地址。
                </p>

                {/* 控制台直链 */}
                {url && token && (() => {
                    const httpUrl = url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
                    const fullUrl = `${httpUrl}/?token=${encodeURIComponent(token)}`
                    return (
                        <div className="flex items-center gap-2 pt-0.5">
                            <div
                                className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-muted/50 border text-[10px] font-mono text-muted-foreground truncate">
                                {fullUrl}
                            </div>
                            <a
                                href={fullUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-medium border hover:bg-accent transition-colors"
                            >
                                <ExternalLink className="h-3 w-3"/>
                                打开
                            </a>
                        </div>
                    )
                })()}
            </div>
        </Card>
    )
}

// ── 启动面板 ──────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
    node: 'Node.js 环境',
    init: '初始化配置',
    start: '启动 Gateway',
    connect: '连接网关',
}

function StartPanel({
                        install,
                        onStart,
                    }: {
    install: InstallState
    onStart: () => void
}) {
    const hasError = Object.values(install.steps).some((s) => s.status === 'error')
    const isDone = install.steps.connect.status === 'done'
    const [logOpen, setLogOpen] = useState(false)

    // 有错误时自动展开日志
    useEffect(() => {
        if (hasError) setLogOpen(true)
    }, [hasError])

    // 收集所有日志行（带步骤前缀）
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

            {/* 步骤进度 */}
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
                                <span
                                    className="text-muted-foreground truncate">{step.logs[step.logs.length - 1]}</span>
                            )}
                        </div>
                    ))}

                    {/* 日志查看器 */}
                    {allLogs.length > 0 && (
                        <div className="pt-1">
                            <button
                                onClick={() => setLogOpen((v) => !v)}
                                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <span className={cn("transition-transform", logOpen ? "rotate-90" : "")}>▶</span>
                                {logOpen ? '收起' : '查看'}启动日志 ({allLogs.length} 行)
                            </button>
                            {logOpen && (
                                <LogViewer lines={allLogs}/>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

function GatewayLogCard({ logs, onClear }: {
    logs: Array<{ line: string; isError: boolean }>
    onClear: () => void
}) {
    const [open, setOpen] = useState(false)
    const ref = React.useRef<HTMLDivElement>(null)

    // 有错误日志时自动展开
    useEffect(() => {
        if (logs.some(l => l.isError)) setOpen(true)
    }, [logs])

    // 自动滚动到底部
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
                    Gateway 进程启动后此处将显示实时输出，便于排查启动失败原因
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

function LogViewer({lines}: { lines: string[] }) {
    const ref = React.useRef<HTMLDivElement>(null)

    // 自动滚动到底部
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
