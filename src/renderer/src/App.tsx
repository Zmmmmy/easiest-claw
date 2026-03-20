import { Component, useCallback, useEffect, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useApp } from '@/store/app-context'
import { AppProvider } from '@/store/app-context'
import { LanguageProvider } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { NavRail } from '@/components/layout/nav-rail'
import { WindowControls } from '@/components/layout/window-controls'
import { ChatView } from '@/components/chat/chat-view'
import { VirtualTeamView } from '@/components/virtual-team/virtual-team-view'
import { CronView } from '@/components/cron/cron-view'
import { OpenclawView } from '@/components/openclaw/openclaw-view'
import { SkillsView } from '@/components/skills/skills-view'
import { AgentConfigView } from '@/components/agent-config/agent-config-view'
import { ChannelsView } from '@/components/channels/channels-view'
import { PluginsView } from '@/components/plugins/plugins-view'
import { PortConflictDialog } from '@/components/openclaw/port-conflict-dialog'
import { OnboardingFlow, GatewayLoadingScreen } from '@/components/onboarding/onboarding-flow'
import { isOnboardingDone } from '@/lib/avatar'
import { useAppUpdate } from '@/hooks/use-app-update'

function MainContent() {
  const { state } = useApp()

  const renderView = () => {
    switch (state.view) {
      case 'chat': return <ChatView />
      case 'virtual-team': return <VirtualTeamView />
      case 'cron': return <CronView />
      case 'openclaw': return <OpenclawView />
      case 'skills': return <SkillsView />
      case 'agent-config': return <AgentConfigView />
      case 'channels': return <ChannelsView />
      case 'plugins': return <PluginsView />
      default: return <ChatView />
    }
  }

  return (
    <div className="h-screen flex overflow-hidden">
      <NavRail />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {renderView()}
      </div>
      <WindowControls />
    </div>
  )
}

function AppRoot() {
  const [onboardingDone, setOnboardingDone] = useState(() => isOnboardingDone())
  const { state } = useApp()

  // 本次会话是否已成功连接过（防止断线重连时回退到启动封面）
  const [everConnected, setEverConnected] = useState(false)
  useEffect(() => {
    if (state.gatewayConnected && !everConnected) setEverConnected(true)
  }, [state.gatewayConnected, everConnected])

  // 稳定引用，避免 gateway 事件导致 AppRoot re-render 时传给 OnboardingFlow 的 onDone 引用变化，
  // 进而触发 ModelCheckStep 内 useEffect 反复执行 checkModels
  const handleOnboardingDone = useCallback(() => setOnboardingDone(true), [])

  // 新用户：走完整 onboarding（gateway loading → profile setup）
  if (!onboardingDone) {
    return <OnboardingFlow onDone={handleOnboardingDone} />
  }

  // 老用户：未连接过 → 显示启动封面（品牌 Logo + 连接进度 + 日志）
  if (!everConnected) {
    return <GatewayLoadingScreen />
  }

  return <MainContent />
}

// ── ErrorBoundary: 防止未捕获的 React 错误导致白屏 ──────────────────────────

interface ErrorBoundaryState {
  error: Error | null
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="h-screen flex items-center justify-center bg-background p-8">
          <div className="max-w-md text-center space-y-4">
            <h2 className="text-lg font-semibold text-destructive">Something went wrong</h2>
            <p className="text-sm text-muted-foreground break-all">{this.state.error.message}</p>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null })
                window.location.reload()
              }}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  useAppUpdate()

  return (
    <LanguageProvider initialLocale="zh-CN" initialPreference="system">
      <TooltipProvider>
        <AppProvider>
          <AppErrorBoundary>
            <AppRoot />
          </AppErrorBoundary>
          <PortConflictDialog />
        </AppProvider>
        <Toaster />
      </TooltipProvider>
    </LanguageProvider>
  )
}

