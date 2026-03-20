import type { IpcMain } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getBundledNodeBin, getBundledOpenclaw } from '../gateway/bundled-process'
import { getOpenclawConfigPath, getOpenclawStateDir } from '../lib/openclaw-config'

interface PluginInfo {
  id: string
  name?: string
  version?: string
  description?: string
  kind?: string
  origin: 'bundled' | 'installed' | 'load-path'
  enabled: boolean
  source?: string
  installPath?: string
}

interface PluginManifest {
  id: string
  name?: string
  version?: string
  description?: string
  kind?: string
}

interface MarketplaceInfo {
  name: string
  source?: string
  repo?: string
  installLocation?: string
  lastUpdated?: string
}

interface MarketplaceEntry {
  name: string
  scope: 'plugins' | 'external_plugins' | 'unknown'
  path?: string
}

interface CliRunResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  output: string
  timedOut: boolean
}

const KNOWN_MARKETPLACES_PATH = path.join(os.homedir(), '.claude', 'plugins', 'known_marketplaces.json')

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === 'object' && !Array.isArray(v))

async function readConfigAsync(): Promise<Record<string, unknown>> {
  const p = getOpenclawConfigPath()
  try {
    const raw = await fs.readFile(p, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function writeConfigAsync(config: Record<string, unknown>): Promise<void> {
  const p = getOpenclawConfigPath()
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(config, null, 2), 'utf8')
}

async function readManifest(dir: string): Promise<PluginManifest | null> {
  try {
    const raw = await fs.readFile(path.join(dir, 'openclaw.plugin.json'), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed) && typeof parsed.id === 'string') {
      return parsed as unknown as PluginManifest
    }
    return null
  } catch {
    return null
  }
}

async function scanExtensionsDir(dir: string): Promise<Map<string, { manifest: PluginManifest; dir: string }>> {
  const result = new Map<string, { manifest: PluginManifest; dir: string }>()
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const tasks = entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const pluginDir = path.join(dir, e.name)
        const manifest = await readManifest(pluginDir)
        if (manifest) result.set(manifest.id, { manifest, dir: pluginDir })
      })
    await Promise.all(tasks)
  } catch {
    // ignore
  }
  return result
}

const BUNDLED_ENABLED_BY_DEFAULT = new Set([
  'device-pair', 'ollama', 'phone-control', 'sglang', 'talk-voice', 'vllm',
])

function resolveEnabled(
  pluginId: string,
  origin: 'bundled' | 'installed' | 'load-path',
  pluginsConfig: Record<string, unknown>,
): boolean {
  const entries = isRecord(pluginsConfig.entries) ? pluginsConfig.entries : {}
  const entry = isRecord(entries[pluginId]) ? entries[pluginId] : null

  if (entry && typeof entry.enabled === 'boolean') return entry.enabled

  const allow = Array.isArray(pluginsConfig.allow) ? pluginsConfig.allow as string[] : []
  const deny = Array.isArray(pluginsConfig.deny) ? pluginsConfig.deny as string[] : []
  if (deny.includes(pluginId)) return false
  if (allow.length > 0 && !allow.includes(pluginId)) {
    return origin === 'bundled' && BUNDLED_ENABLED_BY_DEFAULT.has(pluginId)
  }

  if (origin === 'bundled') return BUNDLED_ENABLED_BY_DEFAULT.has(pluginId)
  return true
}

async function listPluginsLegacy(): Promise<PluginInfo[]> {
  const config = await readConfigAsync()
  const pluginsConfig = isRecord(config.plugins) ? config.plugins : {}
  const installs = isRecord(pluginsConfig.installs)
    ? pluginsConfig.installs as Record<string, Record<string, unknown>>
    : {}

  const stateDir = getOpenclawStateDir()
  const globalExtDir = path.join(stateDir, 'extensions')

  let bundledExtDir: string | undefined
  try {
    const candidates = [
      path.join(process.resourcesPath ?? '', 'openclaw', 'extensions'),
      path.join(process.cwd(), 'resources', 'openclaw', 'extensions'),
    ]
    for (const c of candidates) {
      try {
        await fs.access(c)
        bundledExtDir = c
        break
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }

  const [globalPlugins, bundledPlugins] = await Promise.all([
    scanExtensionsDir(globalExtDir),
    bundledExtDir ? scanExtensionsDir(bundledExtDir) : Promise.resolve(new Map()),
  ])

  const plugins: PluginInfo[] = []
  const seen = new Set<string>()

  for (const [id, { manifest, dir }] of bundledPlugins) {
    seen.add(id)
    plugins.push({
      id,
      name: manifest.name ?? id,
      version: manifest.version,
      description: manifest.description,
      kind: manifest.kind,
      origin: 'bundled',
      enabled: resolveEnabled(id, 'bundled', pluginsConfig),
      installPath: dir,
    })
  }

  for (const [id, { manifest, dir }] of globalPlugins) {
    if (seen.has(id)) continue
    seen.add(id)
    const installRecord = isRecord(installs[id]) ? installs[id] : null
    plugins.push({
      id,
      name: manifest.name ?? id,
      version: manifest.version,
      description: manifest.description,
      kind: manifest.kind,
      origin: installRecord?.source === 'path' ? 'load-path' : 'installed',
      enabled: resolveEnabled(id, 'installed', pluginsConfig),
      source: typeof installRecord?.spec === 'string' ? installRecord.spec : undefined,
      installPath: dir,
    })
  }

  for (const [id, record] of Object.entries(installs)) {
    if (seen.has(id) || !isRecord(record)) continue
    seen.add(id)
    plugins.push({
      id,
      name: id,
      origin: record.source === 'path' ? 'load-path' : 'installed',
      enabled: resolveEnabled(id, 'installed', pluginsConfig),
      source: typeof record.spec === 'string' ? record.spec : undefined,
      installPath: typeof record.installPath === 'string' ? record.installPath : undefined,
    })
  }

  const entries = isRecord(pluginsConfig.entries) ? pluginsConfig.entries : {}
  for (const id of Object.keys(entries)) {
    if (seen.has(id)) continue
    seen.add(id)
    plugins.push({
      id,
      name: id,
      origin: 'installed',
      enabled: resolveEnabled(id, 'installed', pluginsConfig),
    })
  }

  return plugins.sort((a, b) => a.id.localeCompare(b.id))
}

async function uninstallPluginLegacy(pluginId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = await readConfigAsync()
  const pluginsConfig = isRecord(config.plugins) ? config.plugins : {}

  if (isRecord(pluginsConfig.entries)) {
    const { [pluginId]: _removed, ...rest } = pluginsConfig.entries
    pluginsConfig.entries = rest
  }

  let installRecord: Record<string, unknown> | null = null
  let isLinked = false
  if (isRecord(pluginsConfig.installs)) {
    const rec = pluginsConfig.installs[pluginId]
    if (isRecord(rec)) {
      installRecord = rec
      isLinked = rec.source === 'path'
    }
    const { [pluginId]: _removed, ...rest } = pluginsConfig.installs
    pluginsConfig.installs = rest
  }

  if (Array.isArray(pluginsConfig.allow)) {
    pluginsConfig.allow = (pluginsConfig.allow as string[]).filter((id) => id !== pluginId)
  }

  if (isRecord(pluginsConfig.load) && Array.isArray(pluginsConfig.load.paths)) {
    const sourcePath = typeof installRecord?.installPath === 'string' ? installRecord.installPath : null
    if (sourcePath) {
      pluginsConfig.load.paths = (pluginsConfig.load.paths as string[]).filter(
        (p) => path.resolve(p) !== path.resolve(sourcePath),
      )
    }
  }

  if (isRecord(pluginsConfig.slots) && pluginsConfig.slots.memory === pluginId) {
    pluginsConfig.slots.memory = 'memory-lancedb'
  }

  config.plugins = pluginsConfig
  await writeConfigAsync(config)

  if (!isLinked) {
    const stateDir = getOpenclawStateDir()
    const extDir = path.join(stateDir, 'extensions', pluginId)
    try {
      await fs.rm(extDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }

  return { ok: true }
}

function resolveOpenclawCliInvocation(args: string[]): {
  command: string
  args: string[]
  cwd: string
  useShell: boolean
} {
  const bundled = getBundledOpenclaw()
  if (bundled) {
    return {
      command: getBundledNodeBin(),
      args: [bundled.entryScript, ...args],
      cwd: bundled.openclawDir,
      useShell: false,
    }
  }

  return {
    command: 'openclaw',
    args,
    cwd: process.cwd(),
    useShell: process.platform === 'win32',
  }
}

async function runOpenclawCli(args: string[], timeoutMs = 180_000): Promise<CliRunResult> {
  const invocation = resolveOpenclawCliInvocation(args)

  return new Promise<CliRunResult>((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let finished = false

    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      windowsHide: true,
      shell: invocation.useShell,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const finalize = (code: number | null) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      stdout = stdout.trim()
      stderr = stderr.trim()
      const output = [stdout, stderr].filter(Boolean).join('\n')
      resolve({
        ok: !timedOut && code === 0,
        code,
        stdout,
        stderr,
        output,
        timedOut,
      })
    }

    child.stdout?.on('data', (chunk: Buffer | string) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString() })
    child.on('error', (err) => {
      stderr += err.message
      finalize(null)
    })
    child.on('close', (code) => finalize(code))

    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        // ignore
      }
    }, timeoutMs)
  })
}

function parseJsonFromText(text: string): unknown | null {
  const starts: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '{' || ch === '[') starts.push(i)
  }

  for (const start of starts) {
    const first = text[start]
    if (first !== '{' && first !== '[') continue

    const stack: string[] = []
    let inString = false
    let escaped = false

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i]

      if (inString) {
        if (escaped) {
          escaped = false
          continue
        }
        if (ch === '\\') {
          escaped = true
          continue
        }
        if (ch === '"') {
          inString = false
        }
        continue
      }

      if (ch === '"') {
        inString = true
        continue
      }

      if (ch === '{' || ch === '[') {
        stack.push(ch)
        continue
      }

      if (ch !== '}' && ch !== ']') continue
      if (stack.length === 0) break

      const open = stack.pop()
      if (!open) break

      if ((open === '{' && ch !== '}') || (open === '[' && ch !== ']')) break
      if (stack.length !== 0) continue

      const raw = text.slice(start, i + 1)
      try {
        return JSON.parse(raw)
      } catch {
        break
      }
    }
  }

  return null
}

function extractSemanticError(output: string): string | null {
  const normalized = output.replace(/\r/g, '\n')
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)

  const hardFail = lines.find((line) =>
    /^error:\s+/i.test(line) ||
    /could not be (enabled|disabled|installed|uninstalled|updated)/i.test(line),
  )
  return hardFail ?? null
}

async function listPluginsViaCli(): Promise<PluginInfo[] | null> {
  const result = await runOpenclawCli(['plugins', 'list', '--json'], 180_000)
  if (!result.ok) return null

  const payload = parseJsonFromText(result.stdout || result.output)
  if (!isRecord(payload)) return null
  if (!Array.isArray(payload.plugins)) return null

  const plugins: PluginInfo[] = []
  for (const item of payload.plugins) {
    if (!isRecord(item) || typeof item.id !== 'string') continue

    const originRaw = typeof item.origin === 'string' ? item.origin : 'installed'
    const normalizedOrigin: PluginInfo['origin'] =
      originRaw === 'bundled'
        ? 'bundled'
        : (originRaw === 'load-path' || originRaw === 'linked' || originRaw === 'workspace')
          ? 'load-path'
          : 'installed'

    const source = typeof item.source === 'string' ? item.source : undefined
    const inferredInstallPath = source && path.isAbsolute(source) ? path.dirname(source) : undefined

    plugins.push({
      id: item.id,
      name: typeof item.name === 'string' ? item.name : item.id,
      version: typeof item.version === 'string' ? item.version : undefined,
      description: typeof item.description === 'string' ? item.description : undefined,
      kind: typeof item.kind === 'string' ? item.kind : undefined,
      origin: normalizedOrigin,
      enabled: Boolean(item.enabled),
      source,
      installPath: inferredInstallPath,
    })
  }

  return plugins.sort((a, b) => a.id.localeCompare(b.id))
}

async function readKnownMarketplaces(): Promise<MarketplaceInfo[]> {
  try {
    const raw = await fs.readFile(KNOWN_MARKETPLACES_PATH, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return []

    const marketplaces: MarketplaceInfo[] = []
    for (const [name, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue
      const sourceObj = isRecord(value.source) ? value.source : {}
      marketplaces.push({
        name,
        source: typeof sourceObj.source === 'string' ? sourceObj.source : undefined,
        repo: typeof sourceObj.repo === 'string' ? sourceObj.repo : undefined,
        installLocation: typeof value.installLocation === 'string' ? value.installLocation : undefined,
        lastUpdated: typeof value.lastUpdated === 'string' ? value.lastUpdated : undefined,
      })
    }

    return marketplaces.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

async function scanMarketplaceEntriesFromLocal(installLocation: string): Promise<MarketplaceEntry[]> {
  const result: MarketplaceEntry[] = []
  const scopes: Array<{ dir: string; scope: MarketplaceEntry['scope'] }> = [
    { dir: 'plugins', scope: 'plugins' },
    { dir: 'external_plugins', scope: 'external_plugins' },
  ]

  for (const scope of scopes) {
    const scopeDir = path.join(installLocation, scope.dir)
    try {
      const entries = await fs.readdir(scopeDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        result.push({
          name: entry.name,
          scope: scope.scope,
          path: path.join(scopeDir, entry.name),
        })
      }
    } catch {
      // skip missing scope directories
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name))
}

function normalizeMarketplaceEntries(payload: unknown): MarketplaceEntry[] {
  const rawList = (() => {
    if (Array.isArray(payload)) return payload
    if (isRecord(payload) && Array.isArray(payload.plugins)) return payload.plugins
    if (isRecord(payload) && Array.isArray(payload.entries)) return payload.entries
    if (isRecord(payload) && Array.isArray(payload.items)) return payload.items
    return []
  })()

  const entries: MarketplaceEntry[] = []
  for (const item of rawList) {
    if (typeof item === 'string') {
      entries.push({ name: item, scope: 'unknown' })
      continue
    }
    if (!isRecord(item)) continue

    const name = typeof item.name === 'string'
      ? item.name
      : typeof item.id === 'string'
        ? item.id
        : typeof item.slug === 'string'
          ? item.slug
          : ''
    if (!name) continue

    const scopeRaw = typeof item.scope === 'string' ? item.scope : 'unknown'
    const scope = scopeRaw === 'plugins' || scopeRaw === 'external_plugins'
      ? scopeRaw
      : 'unknown'

    entries.push({
      name,
      scope,
      path: typeof item.path === 'string' ? item.path : undefined,
    })
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

async function listMarketplaceEntriesViaCli(marketplace: string): Promise<MarketplaceEntry[] | null> {
  const result = await runOpenclawCli(['plugins', 'marketplace', 'list', marketplace, '--json'], 180_000)
  if (!result.ok) {
    if (/unknown command ['"]marketplace['"]/i.test(result.output)) return null
    return null
  }

  const payload = parseJsonFromText(result.stdout || result.output)
  if (!payload) return []
  return normalizeMarketplaceEntries(payload)
}

export function registerPluginHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('openclaw:plugins:list', async () => {
    try {
      const fromCli = await listPluginsViaCli()
      if (fromCli) return { ok: true, plugins: fromCli }

      const plugins = await listPluginsLegacy()
      return { ok: true, plugins }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('openclaw:plugins:marketplaces', async () => {
    try {
      const marketplaces = await readKnownMarketplaces()
      return { ok: true, marketplaces }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('openclaw:plugins:marketplace:list', async (_event, params: { marketplace: string }) => {
    try {
      const marketplace = typeof params?.marketplace === 'string' ? params.marketplace.trim() : ''
      if (!marketplace) return { ok: false, error: '缺少市场名称' }

      const cliEntries = await listMarketplaceEntriesViaCli(marketplace)
      if (cliEntries && cliEntries.length > 0) {
        return { ok: true, entries: cliEntries, source: 'cli' }
      }

      const known = await readKnownMarketplaces()
      const target = known.find((m) => m.name === marketplace)
      if (!target?.installLocation) {
        if (cliEntries && cliEntries.length === 0) {
          return { ok: true, entries: [], source: 'cli' }
        }
        return {
          ok: false,
          error: '当前 OpenClaw 版本不支持 marketplace list，且本地未找到该市场缓存',
        }
      }

      const localEntries = await scanMarketplaceEntriesFromLocal(target.installLocation)
      return {
        ok: true,
        entries: localEntries,
        source: 'local-cache',
        fallback: true,
      }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('openclaw:plugins:install', async (_event, params: {
    spec: string
    link?: boolean
    pin?: boolean
  }) => {
    try {
      const spec = typeof params?.spec === 'string' ? params.spec.trim() : ''
      if (!spec) return { ok: false, error: '缺少插件安装源（spec）' }

      const args = ['plugins', 'install', spec]
      if (params.link) args.push('--link')
      if (params.pin) args.push('--pin')

      const result = await runOpenclawCli(args, 600_000)
      const semanticError = extractSemanticError(result.output)
      if (!result.ok || semanticError) {
        return {
          ok: false,
          error: (semanticError ?? result.output) || `安装失败（exit=${result.code ?? 'unknown'}）`,
        }
      }
      return { ok: true, output: result.output }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('openclaw:plugins:enable', async (_event, params: { pluginId: string }) => {
    try {
      const pluginId = typeof params?.pluginId === 'string' ? params.pluginId.trim() : ''
      if (!pluginId) return { ok: false, error: '缺少插件 ID' }

      const result = await runOpenclawCli(['plugins', 'enable', pluginId], 180_000)
      const semanticError = extractSemanticError(result.output)
      if (!result.ok || semanticError) {
        return {
          ok: false,
          error: (semanticError ?? result.output) || `启用失败（exit=${result.code ?? 'unknown'}）`,
        }
      }
      return { ok: true, output: result.output }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('openclaw:plugins:disable', async (_event, params: { pluginId: string }) => {
    try {
      const pluginId = typeof params?.pluginId === 'string' ? params.pluginId.trim() : ''
      if (!pluginId) return { ok: false, error: '缺少插件 ID' }

      const result = await runOpenclawCli(['plugins', 'disable', pluginId], 180_000)
      const semanticError = extractSemanticError(result.output)
      if (!result.ok || semanticError) {
        return {
          ok: false,
          error: (semanticError ?? result.output) || `禁用失败（exit=${result.code ?? 'unknown'}）`,
        }
      }
      return { ok: true, output: result.output }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('openclaw:plugins:update', async (_event, params: {
    pluginId?: string
    all?: boolean
    dryRun?: boolean
  }) => {
    try {
      const args = ['plugins', 'update']
      const pluginId = typeof params?.pluginId === 'string' ? params.pluginId.trim() : ''

      if (params?.all) {
        args.push('--all')
      } else if (pluginId) {
        args.push(pluginId)
      } else {
        return { ok: false, error: '请传入 pluginId 或 all=true' }
      }
      if (params?.dryRun) args.push('--dry-run')

      const result = await runOpenclawCli(args, 600_000)
      const semanticError = extractSemanticError(result.output)
      if (!result.ok || semanticError) {
        return {
          ok: false,
          error: (semanticError ?? result.output) || `更新失败（exit=${result.code ?? 'unknown'}）`,
        }
      }
      return { ok: true, output: result.output }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('openclaw:plugins:inspect', async (_event, params: { pluginId: string }) => {
    try {
      const pluginId = typeof params?.pluginId === 'string' ? params.pluginId.trim() : ''
      if (!pluginId) return { ok: false, error: '缺少插件 ID' }

      // 文档新版本使用 inspect，当前 2026.3.13 仍叫 info，这里做兼容。
      let result = await runOpenclawCli(['plugins', 'inspect', pluginId, '--json'], 180_000)
      if (
        !result.ok &&
        /unknown command ['"]inspect['"]/i.test(result.output)
      ) {
        result = await runOpenclawCli(['plugins', 'info', pluginId, '--json'], 180_000)
      }

      if (!result.ok) {
        return {
          ok: false,
          error: result.output || `查询详情失败（exit=${result.code ?? 'unknown'}）`,
        }
      }

      const detail = parseJsonFromText(result.stdout || result.output)
      if (!detail) {
        return {
          ok: false,
          error: '插件详情解析失败',
          output: result.output,
        }
      }

      return { ok: true, detail, output: result.output }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('openclaw:plugins:doctor', async () => {
    try {
      const result = await runOpenclawCli(['plugins', 'doctor'], 180_000)
      if (!result.ok) {
        return {
          ok: false,
          error: result.output || `诊断失败（exit=${result.code ?? 'unknown'}）`,
        }
      }
      return { ok: true, report: result.output }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('openclaw:plugins:uninstall', async (_event, params: {
    pluginId: string
    dryRun?: boolean
    keepFiles?: boolean
  }) => {
    try {
      const pluginId = typeof params?.pluginId === 'string' ? params.pluginId.trim() : ''
      if (!pluginId) return { ok: false, error: '缺少插件 ID' }

      const args = ['plugins', 'uninstall', pluginId, '--force']
      if (params.dryRun) args.push('--dry-run')
      if (params.keepFiles) args.push('--keep-files')

      const result = await runOpenclawCli(args, 600_000)
      const semanticError = extractSemanticError(result.output)
      if (result.ok && !semanticError) {
        return { ok: true, output: result.output }
      }

      if (!params.dryRun && !params.keepFiles) {
        const legacy = await uninstallPluginLegacy(pluginId)
        if (legacy.ok) {
          return {
            ok: true,
            output: result.output,
            fallback: true,
          }
        }
      }

      return {
        ok: false,
        error: (semanticError ?? result.output) || `卸载失败（exit=${result.code ?? 'unknown'}）`,
      }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}
