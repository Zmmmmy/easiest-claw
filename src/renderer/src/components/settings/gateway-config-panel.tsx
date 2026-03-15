import { useState, useEffect } from "react"
import {
    Eye,
    EyeOff,
    ExternalLink,
    Loader2,
    Save,
    Zap,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function GatewayConfigPanel() {
    const [url, setUrl] = useState('')
    const [token, setToken] = useState('')
    const [showToken, setShowToken] = useState(false)
    const [saving, setSaving] = useState(false)
    const [detecting, setDetecting] = useState(false)

    useEffect(() => {
        window.ipc.settingsGetFull().then((res) => {
            const s = res as { gateway?: { url?: string; token?: string } | null }
            setUrl(s?.gateway?.url ?? '')
            setToken(s?.gateway?.token ?? '')
        }).catch(() => {})
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
            const res = await window.ipc.settingsSaveGateway({ url: url.trim(), token: token.trim() })
            const r = res as { ok: boolean; error?: string }
            if (r.ok) {
                toast.success('配置已保存，正在重新连接...')
            } else {
                toast.error(r.error ?? '保存失败')
            }
        } catch {
            toast.error('保存失败')
        } finally {
            setSaving(false)
        }
    }

    const consoleUrl = url && token
        ? `${url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')}/?token=${encodeURIComponent(token)}`
        : null

    return (
        <div className="space-y-4">
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
                                ? <EyeOff className="h-3.5 w-3.5" />
                                : <Eye className="h-3.5 w-3.5" />
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
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Zap className="h-3 w-3" />
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
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Save className="h-3 w-3" />
                        }
                        保存并连接
                    </Button>
                </div>

                <p className="text-[11px] text-muted-foreground">
                    "自动检测"读取本地 <code className="text-[10px] bg-muted px-1 py-0.5 rounded">~/.openclaw/openclaw.json</code>；也可手动填写远程网关地址。
                </p>

                {/* 控制台直链 */}
                {consoleUrl && (
                    <div className="flex items-center gap-2 pt-0.5">
                        <div className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-muted/50 border text-[10px] font-mono text-muted-foreground truncate">
                            {consoleUrl}
                        </div>
                        <a
                            href={consoleUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-medium border hover:bg-accent transition-colors"
                        >
                            <ExternalLink className="h-3 w-3" />
                            打开
                        </a>
                    </div>
                )}
            </div>
        </div>
    )
}
