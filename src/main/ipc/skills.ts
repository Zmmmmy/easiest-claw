import type { IpcMain } from 'electron'
import { net } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gw } from './gw'
import { isRecord, readOpenclawConfig as readConfig, writeOpenclawConfig as writeConfig } from '../lib/openclaw-config'

const SKILLS_SH_BASE = 'https://skills.sh'
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com'

// ── In-memory cache to avoid rate limits ─────────────────────────────────────
interface CacheEntry<T> { data: T; expiresAt: number }
const apiCache = new Map<string, CacheEntry<unknown>>()

function getCached<T>(key: string): T | undefined {
  const entry = apiCache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    apiCache.delete(key)
    return undefined
  }
  return entry.data as T
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  apiCache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

const CACHE_TTL_EXPLORE = 15 * 60_000  // 15 min for explore/browse
const CACHE_TTL_SEARCH  = 5 * 60_000   // 5 min for search

/** Skill item as returned from skills.sh HTML parsing */
interface SkillsShItem {
  source: string      // e.g. "vercel-labs/agent-skills"
  skillId: string     // e.g. "vercel-react-best-practices"
  name: string
  installs?: number
  installsYesterday?: number
  change?: number
  description?: string
}

/** Fetch a URL and return the response body as text */
async function fetchText(url: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const request = net.request({ url, method: 'GET' })
    request.setHeader('Accept', 'text/html,application/json')
    request.setHeader('User-Agent', 'EasiestClaw-Desktop/1.0')
    let body = ''
    request.on('response', (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.on('data', () => {})
        response.on('end', () => reject(new Error(`HTTP ${response.statusCode}`)))
        return
      }
      response.on('data', (chunk) => { body += chunk.toString() })
      response.on('end', () => resolve(body))
    })
    request.on('error', reject)
    request.end()
  })
}

/** Fetch a URL and save response bytes to disk */
async function fetchToFile(url: string, destPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = net.request({ url, method: 'GET' })
    request.setHeader('User-Agent', 'EasiestClaw-Desktop/1.0')
    request.on('response', (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        let body = ''
        response.on('data', (chunk) => { body += chunk.toString() })
        response.on('end', () => reject(new Error(`HTTP ${response.statusCode}: ${body.slice(0, 200)}`)))
        return
      }
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(Buffer.from(chunk)) })
      response.on('end', () => {
        fs.writeFile(destPath, Buffer.concat(chunks)).then(resolve).catch(reject)
      })
    })
    request.on('error', reject)
    request.end()
  })
}

/**
 * Parse skills.sh HTML page and extract the embedded skill list from
 * Next.js streaming data (`self.__next_f.push(...)` script tags).
 */
function parseSkillsShHtml(html: string): SkillsShItem[] {
  const items: SkillsShItem[] = []
  const seen = new Set<string>()

  // Extract all JSON-looking fragments from __next_f push calls
  const pushRe = /self\.__next_f\.push\(\[1,(".*?")\]\)/gs
  let m: RegExpExecArray | null
  while ((m = pushRe.exec(html)) !== null) {
    let str: string
    try {
      // The argument is a JSON-encoded string — decode it
      str = JSON.parse(m[1]) as string
    } catch {
      continue
    }

    // Look for arrays of objects with skillId field
    const arrayRe = /\[\s*\{[^[\]]*?"skillId"\s*:/g
    let am: RegExpExecArray | null
    while ((am = arrayRe.exec(str)) !== null) {
      // Find the complete JSON array starting at this position
      const start = am.index
      let depth = 0
      let inStr = false
      let escape = false
      let end = start
      for (let i = start; i < str.length; i++) {
        const ch = str[i]
        if (escape) { escape = false; continue }
        if (ch === '\\' && inStr) { escape = true; continue }
        if (ch === '"') { inStr = !inStr; continue }
        if (inStr) continue
        if (ch === '[' || ch === '{') depth++
        else if (ch === ']' || ch === '}') {
          depth--
          if (depth === 0) { end = i + 1; break }
        }
      }
      try {
        const arr = JSON.parse(str.slice(start, end)) as unknown[]
        for (const raw of arr) {
          const r = raw as Record<string, unknown>
          const skillId = typeof r.skillId === 'string' ? r.skillId : ''
          const source = typeof r.source === 'string' ? r.source : ''
          if (!skillId || !source || seen.has(skillId)) continue
          seen.add(skillId)
          items.push({
            source,
            skillId,
            name: typeof r.name === 'string' ? r.name : skillId,
            installs: typeof r.installs === 'number' ? r.installs : undefined,
            installsYesterday: typeof r.installsYesterday === 'number' ? r.installsYesterday : undefined,
            change: typeof r.change === 'number' ? r.change : undefined,
            description: typeof r.description === 'string' ? r.description : undefined,
          })
        }
      } catch {
        // Not a valid JSON array, skip
      }
    }
  }

  return items
}

/** Fetch and parse the skills.sh page, returning deduplicated skill list */
async function fetchSkillsSh(page = ''): Promise<SkillsShItem[]> {
  const url = page ? `${SKILLS_SH_BASE}/${page}` : SKILLS_SH_BASE
  console.log(`[skills.sh] Fetching ${url}`)
  const html = await fetchText(url)
  const items = parseSkillsShHtml(html)
  console.log(`[skills.sh] Parsed ${items.length} skills from ${url}`)
  return items
}

/** Resolve the openclaw state dir (~/.openclaw) */
function getStateDir(): string {
  const envDir = process.env.OPENCLAW_STATE_DIR?.trim()
  return envDir
    ? path.resolve(envDir.replace(/^~(?=$|[\\/])/, os.homedir()))
    : path.join(os.homedir(), '.openclaw')
}

export const registerSkillsHandlers = (ipcMain: IpcMain): void => {
  // Clear API cache (used by marketplace refresh button)
  ipcMain.handle('clawhub:cache-clear', () => {
    apiCache.clear()
    return { ok: true }
  })

  // Get global skills list from gateway
  ipcMain.handle('skills:list', async () => {
    return gw('skills.status', {})
  })

  // Toggle a skill globally via gateway
  ipcMain.handle('skills:toggle', async (_event, params: { name: string; enabled: boolean }) => {
    return gw('skills.update', { name: params.name, enabled: params.enabled })
  })

  // Search skills from skills.sh (client-side filter on cached explore data)
  ipcMain.handle('clawhub:search', async (_event, params: { query: string; limit?: number }) => {
    try {
      const q = params.query.trim().toLowerCase()
      const limit = params.limit ?? 20
      const cacheKey = `explore:all`
      let all = getCached<SkillsShItem[]>(cacheKey)
      if (!all) {
        const [popular, hot] = await Promise.all([
          fetchSkillsSh(''),
          fetchSkillsSh('hot'),
        ])
        const seen = new Set<string>()
        const merged: SkillsShItem[] = []
        for (const item of [...popular, ...hot]) {
          if (!seen.has(item.skillId)) { seen.add(item.skillId); merged.push(item) }
        }
        all = merged
        setCache(cacheKey, all, CACHE_TTL_EXPLORE)
      }
      const results = q
        ? all.filter(
            (s) =>
              s.skillId.toLowerCase().includes(q) ||
              s.name.toLowerCase().includes(q) ||
              s.source.toLowerCase().includes(q) ||
              (s.description ?? '').toLowerCase().includes(q)
          )
        : all
      const result = { ok: true as const, results: results.slice(0, limit) }
      return result
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Search failed' }
    }
  })

  // Browse / explore skills from skills.sh — fetches and parses the HTML pages
  ipcMain.handle('clawhub:explore', async (_event, params: { limit?: number; cursor?: string }) => {
    try {
      const limit = params.limit ?? 30
      const cacheKey = `explore:all`
      let all = getCached<SkillsShItem[]>(cacheKey)
      if (all) {
        console.log(`[skills.sh] explore cache hit (${all.length} items)`)
      } else {
        const [popular, hot] = await Promise.all([
          fetchSkillsSh(''),
          fetchSkillsSh('hot'),
        ])
        const seen = new Set<string>()
        const merged: SkillsShItem[] = []
        for (const item of [...popular, ...hot]) {
          if (!seen.has(item.skillId)) { seen.add(item.skillId); merged.push(item) }
        }
        all = merged
        setCache(cacheKey, all, CACHE_TTL_EXPLORE)
      }

      // Simple cursor-based pagination over the in-memory list
      const offset = params.cursor ? parseInt(params.cursor, 10) : 0
      const page = all.slice(offset, offset + limit)
      const nextOffset = offset + limit
      const nextCursor = nextOffset < all.length ? String(nextOffset) : null

      const result = {
        ok: true as const,
        items: page,
        nextCursor,
      }
      return result
    } catch (err) {
      console.error(`[skills.sh] explore error:`, err instanceof Error ? err.message : err)
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to fetch skills' }
    }
  })

/**
 * Use the GitHub git trees API (unauthenticated, no rate-limit concern for
 * occasional installs) to list all SKILL.md paths inside a repo, then
 * download each and check if its frontmatter `name` matches the target skillId.
 *
 * Returns the raw SKILL.md content on match, or null.
 */
async function findSkillMdByName(
  source: string,
  skillId: string,
): Promise<string | null> {
  // Step 1: Get the repo tree to find all SKILL.md paths
  const treeUrl = `https://api.github.com/repos/${source}/git/trees/main?recursive=1`
  let treePaths: string[] = []
  try {
    const treeJson = await fetchText(treeUrl)
    const tree = JSON.parse(treeJson) as { tree?: { path?: string }[] }
    treePaths = (tree.tree ?? [])
      .map((n) => n.path ?? '')
      .filter((p) => p.endsWith('/SKILL.md') || p === 'SKILL.md')
  } catch {
    // Try master branch
    try {
      const treeJson = await fetchText(
        `https://api.github.com/repos/${source}/git/trees/master?recursive=1`,
      )
      const tree = JSON.parse(treeJson) as { tree?: { path?: string }[] }
      treePaths = (tree.tree ?? [])
        .map((n) => n.path ?? '')
        .filter((p) => p.endsWith('/SKILL.md') || p === 'SKILL.md')
    } catch {
      return null
    }
  }

  console.log(`[skills.sh] Found ${treePaths.length} SKILL.md files in ${source}`)
  if (treePaths.length === 0) return null

  // Heuristic: sort paths that might contain part of the skillId first
  const idLower = skillId.toLowerCase()
  treePaths.sort((a, b) => {
    const aMatch = a.toLowerCase().includes(idLower) ? 0 : 1
    const bMatch = b.toLowerCase().includes(idLower) ? 0 : 1
    return aMatch - bMatch
  })

  // Step 2: Download each SKILL.md and check frontmatter name
  for (const p of treePaths) {
    // Determine the branch from whichever tree API succeeded
    for (const branch of ['main', 'master']) {
      const url = `${GITHUB_RAW_BASE}/${source}/${branch}/${p}`
      try {
        const content = await fetchText(url)
        // Parse YAML frontmatter: ---\nname: <value>\n---
        const fmMatch = /^---\s*\n([\s\S]*?)\n---/.exec(content)
        if (fmMatch) {
          const nameMatch = /^name:\s*["']?([^\n"']+)["']?\s*$/m.exec(fmMatch[1])
          if (nameMatch && nameMatch[1].trim() === skillId) {
            console.log(`[skills.sh] Matched ${skillId} at ${p}`)
            return content
          }
        }
      } catch {
        // Try next branch or path
      }
    }
  }

  return null
}

  // Install a skill from skills.sh
  // 1. Use GitHub tree API to find all SKILL.md files in the repo
  // 2. Download each and check frontmatter name against skillId
  // 3. Write matched SKILL.md to ~/.openclaw/skills/<skillId>/SKILL.md
  ipcMain.handle('clawhub:install', async (_event, params: { name: string; installId: string }) => {
    const skillId = params.name

    try {
      console.log(`[skills.sh] Installing skill: ${skillId}`)

      // Resolve source from cache
      const cached = getCached<SkillsShItem[]>('explore:all') ?? []
      const item = cached.find((s) => s.skillId === skillId)
      const source = item?.source  // e.g. "vercel-labs/agent-skills"
      if (!source) {
        return { ok: false, error: `Skill "${skillId}" not found in local cache. Please refresh the marketplace first.` }
      }

      // Use GitHub tree API to find the correct SKILL.md by frontmatter name
      let skillContent = await findSkillMdByName(source, skillId)

      // Fallback: try simple path guessing (for repos where skillId == directory name)
      if (skillContent === null) {
        const fallbackPaths = [`SKILL.md`, `skills/${skillId}/SKILL.md`, `${skillId}/SKILL.md`]
        for (const branch of ['main', 'master']) {
          for (const p of fallbackPaths) {
            try {
              skillContent = await fetchText(`${GITHUB_RAW_BASE}/${source}/${branch}/${p}`)
              console.log(`[skills.sh] Fallback found SKILL.md at ${source}/${branch}/${p}`)
              break
            } catch { /* try next */ }
          }
          if (skillContent !== null) break
        }
      }

      if (skillContent === null) {
        return { ok: false, error: `Could not find SKILL.md for "${skillId}" in ${source}` }
      }

      // Write to ~/.openclaw/skills/<skillId>/SKILL.md
      const stateDir = getStateDir()
      const targetDir = path.join(stateDir, 'skills', skillId)
      await fs.mkdir(targetDir, { recursive: true })
      await fs.writeFile(path.join(targetDir, 'SKILL.md'), skillContent, 'utf-8')

      // Write skill-origin.json
      const origin = {
        registry: SKILLS_SH_BASE,
        source,
        skillId,
        installedAt: new Date().toISOString(),
        installedBy: 'easiest-claw',
      }
      await fs.writeFile(
        path.join(targetDir, 'skill-origin.json'),
        JSON.stringify(origin, null, 2),
        'utf-8'
      )

      console.log(`[skills.sh] Skill ${skillId} installed to ${targetDir}`)
      return { ok: true }
    } catch (err) {
      console.error(`[skills.sh] Install error:`, err instanceof Error ? err.message : err)
      return { ok: false, error: err instanceof Error ? err.message : 'Install failed' }
    }
  })

  // List files in a skill's directory and optionally read a file's content
  ipcMain.handle('skills:files', async (_event, params: { name: string; readFile?: string; baseDir?: string }) => {
    try {
      const skillDir = params.baseDir ?? path.join(getStateDir(), 'skills', params.name)

      // Check if directory exists
      try {
        await fs.access(skillDir)
      } catch {
        return { ok: false, error: 'Skill directory not found' }
      }

      // If readFile is specified, return that file's content
      if (params.readFile) {
        const filePath = path.join(skillDir, params.readFile)
        // Prevent directory traversal
        if (!filePath.startsWith(skillDir)) {
          return { ok: false, error: 'Invalid file path' }
        }
        try {
          const content = await fs.readFile(filePath, 'utf-8')
          return { ok: true, content }
        } catch {
          return { ok: false, error: 'File not found' }
        }
      }

      // List files recursively
      const files: { name: string; size: number; isDir: boolean }[] = []
      const walk = async (dir: string, prefix: string) => {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            files.push({ name: relPath, size: 0, isDir: true })
            await walk(path.join(dir, entry.name), relPath)
          } else {
            const stat = await fs.stat(path.join(dir, entry.name))
            files.push({ name: relPath, size: stat.size, isDir: false })
          }
        }
      }
      await walk(skillDir, '')
      return { ok: true, files }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to list files' }
    }
  })

  // Get per-agent skill allowlist from openclaw.json
  // Returns: { ok: true, skills: string[] | null }
  // null = all skills enabled (no custom allowlist)
  // string[] = only these skills are allowed ([] = none)
  ipcMain.handle('openclaw:agent-skills:get', (_event, agentId: string) => {
    try {
      const config = readConfig()
      const agents = isRecord(config.agents) ? config.agents : {}
      const list = Array.isArray(agents.list) ? (agents.list as unknown[]) : []
      const agent = list.find(
        (a): a is Record<string, unknown> => isRecord(a) && a.id === agentId
      )
      if (!agent) return { ok: true, skills: null }
      const skills = Array.isArray(agent.skills) ? (agent.skills as string[]) : null
      return { ok: true, skills }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // Set per-agent skill allowlist in openclaw.json
  // params.skills = null → remove field (all enabled)
  // params.skills = [] → no skills
  // params.skills = ['a','b'] → only those skills
  ipcMain.handle('openclaw:agent-skills:set', (
    _event,
    params: { agentId: string; skills: string[] | null }
  ) => {
    try {
      const config = readConfig()
      if (!isRecord(config.agents)) config.agents = {}
      const agentsObj = config.agents as Record<string, unknown>
      if (!Array.isArray(agentsObj.list)) agentsObj.list = []
      const list = agentsObj.list as Record<string, unknown>[]
      const idx = list.findIndex((a) => isRecord(a) && a.id === params.agentId)

      if (idx === -1) {
        // Agent not in config file yet — add minimal entry
        const entry: Record<string, unknown> = { id: params.agentId }
        if (params.skills !== null) entry.skills = params.skills
        list.push(entry)
      } else {
        if (params.skills === null) {
          delete list[idx].skills
        } else {
          list[idx] = { ...list[idx], skills: params.skills }
        }
      }

      writeConfig(config)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}
