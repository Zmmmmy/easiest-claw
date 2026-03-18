import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Shared helpers for reading and writing ~/.openclaw/openclaw.json.
 * Respects OPENCLAW_STATE_DIR env override (consistent across all consumers).
 */

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === 'object' && !Array.isArray(v))

export function getOpenclawStateDir(): string {
  const override = process.env.OPENCLAW_STATE_DIR?.trim()
  return override
    ? path.resolve(override.replace(/^~(?=$|[\\/])/, os.homedir()))
    : path.join(os.homedir(), '.openclaw')
}

export function getOpenclawConfigPath(): string {
  return path.join(getOpenclawStateDir(), 'openclaw.json')
}

export function readOpenclawConfig(): Record<string, unknown> {
  const p = getOpenclawConfigPath()
  if (!fs.existsSync(p)) return {}
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function writeOpenclawConfig(config: Record<string, unknown>): void {
  const p = getOpenclawConfigPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf8')
}
