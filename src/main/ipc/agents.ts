import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { shell, type IpcMain } from 'electron'
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
    const res = await gw('agents.update', params)
    if (res.ok) return res

    // Fallback: if the default "main" agent is implicit (not yet in config),
    // gateway returns "agent not found". Materialise it in openclaw.json so the
    // update succeeds.
    const errMsg = typeof (res as { error?: string }).error === 'string' ? (res as { error: string }).error : ''
    if (params.agentId === 'main' && errMsg.includes('not found')) {
      try {
        const { readOpenclawConfig, writeOpenclawConfig, isRecord } = await import('../lib/openclaw-config')
        const config = readOpenclawConfig()
        if (!isRecord(config.agents)) config.agents = {}
        const agentsObj = config.agents as Record<string, unknown>
        if (!Array.isArray(agentsObj.list)) agentsObj.list = []
        const list = agentsObj.list as Record<string, unknown>[]

        // Add "main" entry if missing
        const idx = list.findIndex((a) => isRecord(a) && a.id === 'main')
        const entry: Record<string, unknown> = idx >= 0 ? { ...list[idx] } : { id: 'main' }
        if (params.name) entry.name = params.name
        if (params.workspace) entry.workspace = params.workspace
        if (params.model) entry.model = params.model

        if (idx >= 0) {
          list[idx] = entry
        } else {
          list.push(entry)
        }

        writeOpenclawConfig(config)

        // Retry gateway call now that the agent exists in config
        const retry = await gw('agents.update', params)
        return retry.ok ? retry : { ok: true, result: entry }
      } catch {
        return res
      }
    }

    return res
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

  // ── Full workspace tree scan (filesystem-based) ────────────────────────────

  const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.next', '.cache', '.venv', '.turbo', 'dist', '.DS_Store'])
  const MAX_DEPTH = 5
  const MAX_FILES = 2000

  interface TreeNode {
    name: string
    type: 'file' | 'dir'
    path: string
    size?: number
    updatedAtMs?: number
    children?: TreeNode[]
  }

  async function scanDir(dir: string, basePath: string, depth: number, counter: { count: number }): Promise<TreeNode[]> {
    if (depth > MAX_DEPTH || counter.count >= MAX_FILES) return []
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }

    const dirs: TreeNode[] = []
    const files: TreeNode[] = []

    for (const entry of entries) {
      if (counter.count >= MAX_FILES) break
      if (entry.name.startsWith('.') && SKIP_DIRS.has(entry.name)) continue
      if (SKIP_DIRS.has(entry.name)) continue

      const fullPath = path.join(dir, entry.name)
      const relativePath = path.join(basePath, entry.name).replace(/\\/g, '/')

      if (entry.isDirectory()) {
        const children = await scanDir(fullPath, relativePath, depth + 1, counter)
        dirs.push({ name: entry.name, type: 'dir', path: relativePath, children })
      } else if (entry.isFile()) {
        counter.count++
        try {
          const stat = await fs.stat(fullPath)
          files.push({ name: entry.name, type: 'file', path: relativePath, size: stat.size, updatedAtMs: stat.mtimeMs })
        } catch {
          files.push({ name: entry.name, type: 'file', path: relativePath })
        }
      }
    }

    // Sort: dirs first (alpha), then files (alpha)
    dirs.sort((a, b) => a.name.localeCompare(b.name))
    files.sort((a, b) => a.name.localeCompare(b.name))
    return [...dirs, ...files]
  }

  ipcMain.handle('agents:workspace:tree', async (_event, params: { agentId: string }) => {
    const workspace = await resolveWorkspaceDir(params.agentId)
    if (!workspace) return { ok: false, error: 'Cannot resolve workspace path' }

    try {
      const realWorkspace = await fs.realpath(workspace).catch(() => workspace)
      const tree = await scanDir(realWorkspace, '', 0, { count: 0 })
      return { ok: true, workspace, tree }
    } catch (err) {
      return { ok: false, error: `Failed to scan workspace: ${(err as Error).message}` }
    }
  })

  ipcMain.handle('agents:workspace:read', async (_event, params: { agentId: string; filePath: string }) => {
    const workspace = await resolveWorkspaceDir(params.agentId)
    if (!workspace) return { ok: false, error: 'Cannot resolve workspace path' }

    const filePath = params.filePath
    if (!filePath || filePath.includes('..') || path.isAbsolute(filePath)) {
      return { ok: false, error: 'Invalid file path' }
    }

    const fullPath = path.join(workspace, filePath)
    const realPath = await fs.realpath(fullPath).catch(() => fullPath)
    const realWorkspace = await fs.realpath(workspace).catch(() => workspace)
    if (!realPath.startsWith(realWorkspace)) {
      return { ok: false, error: 'Path escapes workspace' }
    }

    try {
      const stat = await fs.stat(fullPath)
      if (stat.size > 1024 * 1024) {
        return { ok: true, content: null, tooLarge: true }
      }
      // Binary detection: read first 512 bytes and check for NUL
      const buf = Buffer.alloc(Math.min(512, stat.size))
      const fh = await fs.open(fullPath, 'r')
      try {
        await fh.read(buf, 0, buf.length, 0)
      } finally {
        await fh.close()
      }
      if (buf.includes(0)) {
        return { ok: true, content: null, binary: true }
      }
      const content = await fs.readFile(fullPath, 'utf8')
      return { ok: true, content }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, error: 'File not found' }
      }
      return { ok: false, error: `Failed to read file: ${(err as Error).message}` }
    }
  })

  // ── Open file with system default application ──────────────────────────────
  ipcMain.handle('agents:workspace:open', async (_event, params: { agentId: string; filePath: string }) => {
    const workspace = await resolveWorkspaceDir(params.agentId)
    if (!workspace) return { ok: false, error: 'Cannot resolve workspace path' }

    const filePath = params.filePath
    if (!filePath || filePath.includes('..') || path.isAbsolute(filePath)) {
      return { ok: false, error: 'Invalid file path' }
    }

    const fullPath = path.join(workspace, filePath)
    const realPath = await fs.realpath(fullPath).catch(() => fullPath)
    const realWorkspace = await fs.realpath(workspace).catch(() => workspace)
    if (!realPath.startsWith(realWorkspace)) {
      return { ok: false, error: 'Path escapes workspace' }
    }

    const errorMessage = await shell.openPath(realPath)
    if (errorMessage) {
      return { ok: false, error: errorMessage }
    }
    return { ok: true }
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
