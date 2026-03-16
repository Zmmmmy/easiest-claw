import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { IpcMain } from 'electron'
import { gw } from './gw'

// ── Workspace path cache (per agentId) ──────────────────────────────────────
// agents.files.list is cheap but called often; cache workspace dir for 60s.
const workspaceCache = new Map<string, { workspace: string; expiresAt: number }>()

async function resolveWorkspaceDir(agentId: string): Promise<string | null> {
  const cached = workspaceCache.get(agentId)
  if (cached && cached.expiresAt > Date.now()) return cached.workspace

  const res = await gw<{ workspace?: string }>('agents.files.list', { agentId })
  const workspace = res.ok ? (res.result as { workspace?: string })?.workspace ?? null : null
  if (workspace) {
    workspaceCache.set(agentId, { workspace, expiresAt: Date.now() + 60_000 })
  }
  return workspace
}

export const registerAgentHandlers = (ipcMain: IpcMain): void => {
  ipcMain.handle('agents:list', async () => {
    return gw('agents.list', {})
  })

  // Create agent: mirrors mossc-ref /api/intents/agent-create.
  // Gets config path from gateway to derive workspace dir, generates unique suffix.
  ipcMain.handle('agents:create', async (_event, params: { name: string; emoji?: string; avatar?: string; model?: string }) => {
    const configRes = await gw<{ path?: string | null }>('config.get', {})
    if (!configRes.ok) return configRes

    const configPath = typeof configRes.result?.path === 'string' ? configRes.result.path.trim() : ''
    if (!configPath) {
      return { ok: false, error: 'Gateway did not return a config path; cannot create agent workspace.' }
    }
    const stateDir = path.dirname(configPath)
    if (!stateDir || stateDir === '.') {
      return { ok: false, error: `Gateway config path "${configPath}" is missing a directory.` }
    }

    const uniqueSuffix = randomBytes(4).toString('hex')
    const gatewayName = `${uniqueSuffix}-${params.name}`
    const workspace = path.join(stateDir, `workspace-${uniqueSuffix}`)

    const createPayload: Record<string, string> = { name: gatewayName, workspace }
    if (params.emoji) createPayload.emoji = params.emoji
    if (params.avatar) createPayload.avatar = params.avatar

    const res = await gw<{ agentId?: string; name?: string }>('agents.create', createPayload)
    if (!res.ok) return res
    const agentId = (res.result as { agentId?: string })?.agentId ?? gatewayName

    // Rename in config so agents.list returns the clean display name; also set model if provided.
    const updatePayload: Record<string, string> = { agentId, name: params.name }
    if (params.model) updatePayload.model = params.model
    await gw('agents.update', updatePayload)

    return { ok: true, result: { ...(res.result as object), agentId }, displayName: params.name }
  })

  ipcMain.handle('agents:update', async (_event, params: { agentId: string; name?: string; workspace?: string; model?: string; avatar?: string }) => {
    return gw('agents.update', params)
  })

  ipcMain.handle('agents:delete', async (_event, params: { agentId: string }) => {
    return gw('agents.delete', params)
  })

  // agents.files.list — list all workspace files with metadata (name, size, updatedAtMs, missing)
  ipcMain.handle('agents:files:list', async (_event, params: { agentId: string }) => {
    return gw('agents.files.list', params)
  })

  // agents.files.get — get a single file's content
  ipcMain.handle('agents:files:get', async (_event, params: { agentId: string; name: string }) => {
    return gw('agents.files.get', params)
  })

  ipcMain.handle('agents:files:set', async (_event, params: { agentId: string; name: string; content: string }) => {
    return gw('agents.files.set', params)
  })

  // agent.identity.get — get agent identity (name, emoji, avatar)
  ipcMain.handle('agent:identity:get', async (_event, params: { agentId?: string; sessionKey?: string }) => {
    return gw('agent.identity.get', params)
  })

  // tools.catalog — runtime tool catalog for an agent (core vs plugin, optional)
  ipcMain.handle('tools:catalog', async (_event, params: { agentId?: string; sessionKey?: string }) => {
    return gw('tools.catalog', params)
  })

  ipcMain.handle('models:list', async () => {
    return gw('models.list', {})
  })

  ipcMain.handle('system:presence', async () => {
    return gw('system-presence', {})
  })

  ipcMain.handle('system:status', async () => {
    return gw('status', {})
  })

  // ── Memory directory listing (filesystem-based, gateway doesn't expose this) ─
  ipcMain.handle('agents:memory:list', async (_event, params: { agentId: string }) => {
    const workspace = await resolveWorkspaceDir(params.agentId)
    if (!workspace) return { ok: false, error: 'Cannot resolve workspace path' }

    const memoryDir = path.join(workspace, 'memory')
    try {
      const entries = await fs.readdir(memoryDir, { withFileTypes: true })
      const files: Array<{ name: string; size: number; updatedAtMs: number }> = []

      const statPromises = entries
        .filter(e => e.isFile() && e.name.endsWith('.md'))
        .map(async (e) => {
          const stat = await fs.stat(path.join(memoryDir, e.name))
          return { name: e.name, size: stat.size, updatedAtMs: stat.mtimeMs }
        })

      files.push(...await Promise.all(statPromises))
      // Sort by name descending (YYYY-MM-DD.md → newest first)
      files.sort((a, b) => b.name.localeCompare(a.name))

      return { ok: true, files }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: true, files: [] }
      }
      return { ok: false, error: `Failed to read memory directory: ${(err as Error).message}` }
    }
  })

  // Read a file from workspace/memory/ directory
  ipcMain.handle('agents:memory:get', async (_event, params: { agentId: string; name: string }) => {
    const workspace = await resolveWorkspaceDir(params.agentId)
    if (!workspace) return { ok: false, error: 'Cannot resolve workspace path' }

    // Security: only allow .md files and prevent path traversal
    const name = params.name
    if (!name || !name.endsWith('.md') || name.includes('..') || path.isAbsolute(name)) {
      return { ok: false, error: 'Invalid file name' }
    }

    const filePath = path.join(workspace, 'memory', name)
    const realPath = await fs.realpath(filePath).catch(() => filePath)
    const realWorkspace = await fs.realpath(workspace).catch(() => workspace)
    if (!realPath.startsWith(realWorkspace)) {
      return { ok: false, error: 'Path escapes workspace' }
    }

    try {
      const content = await fs.readFile(filePath, 'utf8')
      return { ok: true, content }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: true, content: '' }
      }
      return { ok: false, error: `Failed to read file: ${(err as Error).message}` }
    }
  })
}
