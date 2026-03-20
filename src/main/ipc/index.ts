import type { IpcMain } from 'electron'
import { registerChatHandlers } from './chat'
import { registerAgentHandlers } from './agents'
import { registerConfigHandlers } from './config'
import { registerCronHandlers } from './cron'
import { registerDialogHandlers } from './dialog'
import { registerEnvHandlers } from './env'
import { registerRuntimeHandlers } from './runtime-read'
import { registerSettingsHandlers } from './settings'
import { registerSkillsHandlers } from './skills'
import { registerUpdateHandlers } from './update'
import { registerProviderHealthHandlers } from './provider-health'
import { registerChannelHandlers } from './channels'
import { registerPluginHandlers } from './plugins'

export const registerAllIpcHandlers = (ipcMain: IpcMain): void => {
  registerChatHandlers(ipcMain)
  registerAgentHandlers(ipcMain)
  registerConfigHandlers(ipcMain)
  registerCronHandlers(ipcMain)
  registerDialogHandlers(ipcMain)
  registerEnvHandlers(ipcMain)
  registerRuntimeHandlers(ipcMain)
  registerSettingsHandlers(ipcMain)
  registerSkillsHandlers(ipcMain)
  registerUpdateHandlers(ipcMain)
  registerProviderHealthHandlers(ipcMain)
  registerChannelHandlers(ipcMain)
  registerPluginHandlers(ipcMain)
}
