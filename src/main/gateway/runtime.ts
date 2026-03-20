import type { DomainEvent } from './types'
import { GatewayAdapter } from './adapter'

// Singleton adapter instance
let adapter: GatewayAdapter | null = null
let eventCallback: ((event: DomainEvent) => void) | null = null
let deviceIdentityPath: string | undefined

export const getRuntime = (): GatewayAdapter | null => adapter

export const startRuntime = async (
  onEvent: (event: DomainEvent) => void,
  identityPath?: string
): Promise<void> => {
  eventCallback = onEvent
  deviceIdentityPath = identityPath
  if (!adapter) {
    adapter = new GatewayAdapter((event) => { eventCallback?.(event) }, deviceIdentityPath)
  }
  // Start in background — don't block app startup if gateway is unavailable
  void adapter.start().catch(() => {})
}

export const stopRuntime = async (): Promise<void> => {
  if (adapter) {
    await adapter.stop()
    adapter = null
  }
}

export const restartRuntime = async (): Promise<void> => {
  if (adapter) {
    await adapter.stop()
    adapter = null
  }
  if (eventCallback) {
    adapter = new GatewayAdapter((event) => { eventCallback?.(event) }, deviceIdentityPath)
    void adapter.start().catch(() => {})
  }
}
