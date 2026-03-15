import { useEffect, useState } from 'react'
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

  // 新用户：走完整 onboarding（gateway loading → profile setup）
  if (!onboardingDone) {
    return <OnboardingFlow onDone={() => setOnboardingDone(true)} />
  }

  // 老用户：未连接过 → 显示启动封面（品牌 Logo + 连接进度 + 日志）
  if (!everConnected) {
    return <GatewayLoadingScreen />
  }

  return <MainContent />
}

export default function App() {
  useAppUpdate()

  return (
    <LanguageProvider initialLocale="zh-CN" initialPreference="system">
      <TooltipProvider>
        <AppProvider>
          <AppRoot />
          <PortConflictDialog />
        </AppProvider>
        <Toaster />
      </TooltipProvider>
    </LanguageProvider>
  )
}

