import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

// ── Path helpers ──────────────────────────────────────────────────────────────

const resolveStateDir = (): string => {
  const override = process.env.OPENCLAW_STATE_DIR?.trim()
  if (override) return path.resolve(override.replace(/^~(?=$|[\\/])/, os.homedir()))
  return path.join(os.homedir(), '.openclaw')
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type AppSettings = {
  gateway: { url: string; token: string } | null
  avatars: Record<string, Record<string, string>>
}

// ── Defaults read from ~/.openclaw/openclaw.json ──────────────────────────────

const readOpenclawDefaults = (): { url: string; token: string } | null => {
  try {
    const configPath = path.join(resolveStateDir(), 'openclaw.json')
    if (!fs.existsSync(configPath)) return null
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const gateway = parsed.gateway as Record<string, unknown> | null
    if (!gateway) return null
    const auth = gateway.auth as Record<string, unknown> | null
    const token = typeof auth?.token === 'string' ? auth.token.trim() : ''
    const port =
      typeof gateway.port === 'number' && Number.isFinite(gateway.port)
        ? gateway.port
        : 18789
    if (!token) return null
    return { url: `ws://localhost:${port}`, token }
  } catch {
    return null
  }
}

// ── Settings file: %AppData%/EasiestClaw/settings.json ────────────────────────
// 存放在 Electron userData 目录，与安装目录分离，不随更新安装丢失，
// 卸载时由 NSIS 脚本提示用户清除。

const settingsPath = (): string =>
  path.join(app.getPath('userData'), 'settings.json')

export const loadSettings = (): AppSettings => {
  const p = settingsPath()
  let fromFile: Partial<AppSettings> = {}
  if (fs.existsSync(p)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<AppSettings>
    } catch {
      // ignore parse errors, fall back to defaults
    }
  }

  // If no gateway token saved, try reading from openclaw.json
  if (!fromFile.gateway?.token) {
    const defaults = readOpenclawDefaults()
    if (defaults) {
      fromFile = { ...fromFile, gateway: defaults }
    }
  }

  return {
    gateway: fromFile.gateway ?? null,
    avatars: fromFile.avatars ?? {},
  }
}

export const saveSettings = (next: AppSettings): void => {
  const p = settingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8')
}

export const patchSettings = (patch: Partial<AppSettings>): AppSettings => {
  const current = loadSettings()
  const next: AppSettings = {
    ...current,
    ...patch,
    avatars: patch.avatars
      ? { ...current.avatars, ...patch.avatars }
      : current.avatars
  }
  saveSettings(next)
  return next
}

export const loadOpenclawDefaults = () => readOpenclawDefaults()
