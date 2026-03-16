import { contextBridge, ipcRenderer, webUtils } from 'electron'

// ── Gateway log forwarding (main → renderer) ──────────────────────────────────
type GatewayLogCallback = (log: { line: string; isError: boolean }) => void
const gatewayLogCallbacks = new Set<GatewayLogCallback>()

ipcRenderer.on('gateway:log', (_: Electron.IpcRendererEvent, log: unknown) => {
  for (const cb of gatewayLogCallbacks) {
    cb(log as { line: string; isError: boolean })
  }
})


// NOT inside a contextBridge-exposed function. In Electron 35 with contextIsolation,
// calling ipcRenderer.on from within a contextBridge callback does not work.
type EventCallback = (event: unknown) => void
const gatewayCallbacks = new Set<EventCallback>()

ipcRenderer.on('gateway:event', (_: Electron.IpcRendererEvent, event: unknown) => {
  for (const cb of gatewayCallbacks) {
    cb(event)
  }
})

// ── App update forwarding (main → renderer) ───────────────────────────────────
type AppUpdateStatusCallback = (status: {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  progress?: number
  error?: string
}) => void
const appUpdateCallbacks = new Set<AppUpdateStatusCallback>()

ipcRenderer.on('app:update-status', (_: Electron.IpcRendererEvent, status: unknown) => {
  for (const cb of appUpdateCallbacks) {
    cb(status as Parameters<AppUpdateStatusCallback>[0])
  }
})

// ── Install progress forwarding ───────────────────────────────────────────────
type InstallProgressCallback = (progress: { step: string; status: string; detail?: string }) => void
const installProgressCallbacks = new Set<InstallProgressCallback>()

ipcRenderer.on('env:install-progress', (_: Electron.IpcRendererEvent, progress: unknown) => {
  for (const cb of installProgressCallbacks) {
    cb(progress as { step: string; status: string; detail?: string })
  }
})

// ── Upgrade progress forwarding ───────────────────────────────────────────────
type UpgradeProgressCallback = (progress: { step: string; status: string; detail?: string }) => void
const upgradeProgressCallbacks = new Set<UpgradeProgressCallback>()

ipcRenderer.on('openclaw:upgrade-progress', (_: Electron.IpcRendererEvent, progress: unknown) => {
  for (const cb of upgradeProgressCallbacks) {
    cb(progress as { step: string; status: string; detail?: string })
  }
})

// ── Extract progress forwarding ───────────────────────────────────────────────
type ExtractProgressCallback = (progress: { percent: number; file: string }) => void
const extractProgressCallbacks = new Set<ExtractProgressCallback>()

ipcRenderer.on('openclaw:extract-progress', (_: Electron.IpcRendererEvent, progress: unknown) => {
  for (const cb of extractProgressCallbacks) {
    cb(progress as { percent: number; file: string })
  }
})

// Expose typed IPC API to renderer via window.ipc
const ipcApi = {
  // ── Gateway events (main → renderer push) ──────────────────────────────────
  onGatewayEvent: (callback: EventCallback) => {
    gatewayCallbacks.add(callback)
    return () => gatewayCallbacks.delete(callback)
  },

  // ── Chat ──────────────────────────────────────────────────────────────────
  chatSend: (params: {
    agentId: string
    message: string
    sessionKey: string
    idempotencyKey: string
    attachments?: Array<{ type: string; mimeType: string; content: string }>
  }) => ipcRenderer.invoke('chat:send', params),

  chatAbort: (params: { sessionKey?: string; runId?: string }) =>
    ipcRenderer.invoke('chat:abort', params),

  chatHistory: (params: { agentId: string; sessionKey?: string }) =>
    ipcRenderer.invoke('chat:history', params),

  sessionsList: (params?: { agentId?: string; includeLastMessage?: boolean; includeDerivedTitles?: boolean; activeMinutes?: number; limit?: number }) =>
    ipcRenderer.invoke('sessions:list', params),

  sessionsReset: (params: { sessionKey: string }) =>
    ipcRenderer.invoke('sessions:reset', params),

  sessionsPatch: (params: { sessionKey: string; patch: Record<string, unknown> }) =>
    ipcRenderer.invoke('sessions:patch', params),

  // ── Agents ────────────────────────────────────────────────────────────────
  agentsList: () => ipcRenderer.invoke('agents:list'),
  agentsCreate: (params: { name: string; emoji?: string; avatar?: string; model?: string }) =>
    ipcRenderer.invoke('agents:create', params),
  agentsUpdate: (params: { agentId: string; name?: string; workspace?: string; model?: string; avatar?: string }) =>
    ipcRenderer.invoke('agents:update', params),
  agentsDelete: (params: { agentId: string }) =>
    ipcRenderer.invoke('agents:delete', params),
  agentsFilesList: (params: { agentId: string }) =>
    ipcRenderer.invoke('agents:files:list', params),
  agentsFilesGet: (params: { agentId: string; name: string }) =>
    ipcRenderer.invoke('agents:files:get', params),
  agentsFilesSet: (params: { agentId: string; name: string; content: string }) =>
    ipcRenderer.invoke('agents:files:set', params),
  agentsMemoryList: (params: { agentId: string }) =>
    ipcRenderer.invoke('agents:memory:list', params),
  agentsMemoryGet: (params: { agentId: string; name: string }) =>
    ipcRenderer.invoke('agents:memory:get', params),
  agentIdentityGet: (params: { agentId?: string; sessionKey?: string }) =>
    ipcRenderer.invoke('agent:identity:get', params),
  toolsCatalog: (params: { agentId?: string; sessionKey?: string }) =>
    ipcRenderer.invoke('tools:catalog', params),

  // ── Models & System ───────────────────────────────────────────────────────
  modelsList: () => ipcRenderer.invoke('models:list'),
  systemPresence: () => ipcRenderer.invoke('system:presence'),
  systemStatus: () => ipcRenderer.invoke('system:status'),

  // ── Config ────────────────────────────────────────────────────────────────
  configGet: () => ipcRenderer.invoke('config:get'),
  configPatch: (params: { raw: string; baseHash: string }) =>
    ipcRenderer.invoke('config:patch', params),
  configApply: (params: { raw: string; baseHash: string; sessionKey?: string }) =>
    ipcRenderer.invoke('config:apply', params),
  configSchema: () => ipcRenderer.invoke('config:schema'),

  // ── Exec Approvals ────────────────────────────────────────────────────────
  execApprovalsGet: (params: { agentId?: string }) =>
    ipcRenderer.invoke('exec:approvals:get', params),
  execApprovalsSet: (params: unknown) =>
    ipcRenderer.invoke('exec:approvals:set', params),
  execApprovalResolve: (params: { requestId: string; decision: 'allow' | 'deny' }) =>
    ipcRenderer.invoke('exec:approval:resolve', params),

  // ── Cron ──────────────────────────────────────────────────────────────────
  cronList: () => ipcRenderer.invoke('cron:list'),
  cronAdd: (params: unknown) => ipcRenderer.invoke('cron:add', params),
  cronUpdate: (params: unknown) => ipcRenderer.invoke('cron:update', params),
  cronRemove: (params: { jobId: string }) => ipcRenderer.invoke('cron:remove', params),
  cronRun: (params: { jobId: string }) => ipcRenderer.invoke('cron:run', params),
  cronRuns: (params: { jobId: string }) => ipcRenderer.invoke('cron:runs', params),
  cronStatus: () => ipcRenderer.invoke('cron:status'),

  // ── Runtime ───────────────────────────────────────────────────────────────
  runtimeStatus: () => ipcRenderer.invoke('runtime:status'),
  runtimeFleet: () => ipcRenderer.invoke('runtime:fleet'),

  // ── Logs ──────────────────────────────────────────────────────────────────
  logsGetPath: () => ipcRenderer.invoke('logs:getPath'),

  // ── Settings ──────────────────────────────────────────────────────────────
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsGetFull: () => ipcRenderer.invoke('settings:get-full'),
  settingsSaveGateway: (params: { url: string; token: string }) =>
    ipcRenderer.invoke('settings:save-gateway', params),
  settingsSaveAvatar: (params: { gatewayUrl: string; agentId: string; seed: string }) =>
    ipcRenderer.invoke('settings:save-avatar', params),
  settingsDetectLocal: () => ipcRenderer.invoke('settings:detect-local'),
  settingsGetDataDir: (): Promise<{ dir: string; isCustom: boolean; defaultDir: string }> =>
    ipcRenderer.invoke('settings:get-data-dir'),
  settingsSetDataDir: (params: { dir: string }) =>
    ipcRenderer.invoke('settings:set-data-dir', params),
  settingsResetDataDir: () => ipcRenderer.invoke('settings:reset-data-dir'),

  // ── Direct file access for model config (bypasses gateway validation) ──────
  openclawModelsGet: () => ipcRenderer.invoke('openclaw:models:get'),
  openclawModelsSet: (params: {
    providers?: Record<string, unknown>
    defaults?: { primary: string; fallbacks: string[] }
  }) => ipcRenderer.invoke('openclaw:models:set', params),

  // ── Skills ────────────────────────────────────────────────────────────────
  skillsList: () => ipcRenderer.invoke('skills:list'),
  skillsToggle: (name: string, enabled: boolean) =>
    ipcRenderer.invoke('skills:toggle', { name, enabled }),
  agentSkillsGet: (agentId: string) =>
    ipcRenderer.invoke('openclaw:agent-skills:get', agentId),
  agentSkillsSet: (agentId: string, skills: string[] | null) =>
    ipcRenderer.invoke('openclaw:agent-skills:set', { agentId, skills }),

  // ── Extract progress (main → renderer) ────────────────────────────────────
  onExtractProgress: (callback: ExtractProgressCallback) => {
    extractProgressCallbacks.add(callback)
    return () => extractProgressCallbacks.delete(callback)
  },
  extractStatus: (): Promise<{ phase: string; percent: number; upgradeFrom?: string; upgradeTo?: string }> =>
    ipcRenderer.invoke('openclaw:extract-status'),
  openclawUpgradeConfirm: () => ipcRenderer.invoke('openclaw:upgrade-confirm'),
  openclawUpgradeSkip: () => ipcRenderer.invoke('openclaw:upgrade-skip'),

  // ── Gateway log (main → renderer) ─────────────────────────────────────────
  onGatewayLog: (callback: GatewayLogCallback) => {
    gatewayLogCallbacks.add(callback)
    return () => gatewayLogCallbacks.delete(callback)
  },
  gatewayLogsGet: () => ipcRenderer.invoke('gateway:logs-get'),

  // ── Update ────────────────────────────────────────────────────────────────
  openclawCheckUpdate: () => ipcRenderer.invoke('openclaw:check-update'),
  openclawUpgrade: (version: string) => ipcRenderer.invoke('openclaw:upgrade', { version }),
  openclawUpgradeStateGet: () => ipcRenderer.invoke('openclaw:upgrade-state'),
  onUpgradeProgress: (callback: UpgradeProgressCallback) => {
    upgradeProgressCallbacks.add(callback)
    return () => upgradeProgressCallbacks.delete(callback)
  },

  // ── Environment detection ─────────────────────────────────────────────────
  envDetect: () => ipcRenderer.invoke('env:detect'),
  envInstallOpenclaw: () => ipcRenderer.invoke('env:install-openclaw'),
  gatewayResolveConflict: (action: 'connect' | 'stop-and-start') =>
    ipcRenderer.invoke('gateway:resolve-conflict', { action }),
  onInstallProgress: (callback: InstallProgressCallback) => {
    installProgressCallbacks.add(callback)
    return () => installProgressCallbacks.delete(callback)
  },

  // ── App auto-update ───────────────────────────────────────────────────────
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  appCheckUpdate: () => ipcRenderer.invoke('app:check-update'),
  appDownloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  appInstallUpdate: () => ipcRenderer.invoke('app:install-update'),
  onAppUpdateStatus: (callback: AppUpdateStatusCallback) => {
    appUpdateCallbacks.add(callback)
    return () => appUpdateCallbacks.delete(callback)
  },
  appPaths: (): Promise<{ appPath: string; userData: string; logs: string }> =>
    ipcRenderer.invoke('app:paths'),
  appOpenPath: (targetPath: string): Promise<void> =>
    ipcRenderer.invoke('app:open-path', targetPath),

  // ── Window controls (frameless) ───────────────────────────────────────────
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  onMaximizedChanged: (cb: (isMaximized: boolean) => void) => {
    const listener = (_: Electron.IpcRendererEvent, val: boolean) => cb(val)
    ipcRenderer.on('window:maximized-changed', listener)
    return () => ipcRenderer.removeListener('window:maximized-changed', listener)
  },
  platform: process.platform,

  // ── Dialog ────────────────────────────────────────────────────────────────
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),

  // ── Provider health check (main process, avoids CORS) ─────────────────────
  providerHealthCheck: (params: { baseUrl: string; apiKey: string; api: string }) =>
    ipcRenderer.invoke('provider:health-check', params),

  // ── Channels (direct file access) ────────────────────────────────────────
  channelsGet: () => ipcRenderer.invoke('openclaw:channels:get'),
  channelsSet: (params: { channelId: string; config: Record<string, unknown> }) =>
    ipcRenderer.invoke('openclaw:channels:set', params),

  // ── File path (Electron 32+ replaces deprecated file.path) ───────────────
  getFilePath: (file: File) => webUtils.getPathForFile(file),
}

contextBridge.exposeInMainWorld('ipc', ipcApi)

// Data location prompt API
contextBridge.exposeInMainWorld('electronAPI', {
  chooseDir: () => ipcRenderer.invoke('data-location:choose'),
  useDefault: () => ipcRenderer.invoke('data-location:default')
})

// TypeScript type augmentation — declare in renderer via window.ipc
export type IpcApi = typeof ipcApi
