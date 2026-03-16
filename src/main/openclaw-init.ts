/**
 * openclaw-init.ts
 *
 * OpenClaw 初始化工具函数：
 * - sanitizeOpenClawConfig     : 启动前清理无效配置字段
 * - extractOpenClawIfNeeded    : 首次启动时并行解压 openclaw-*.zip，并向渲染进程推送进度
 */

import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { Worker } from 'worker_threads'
import { createRequire } from 'module'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { isRecord, readOpenclawConfig, writeOpenclawConfig } from './lib/openclaw-config'
import { logger } from './lib/logger'

// ── 解压状态（IPC 查询用）─────────────────────────────────────────────────────
export type ExtractPhase = 'idle' | 'extracting' | 'done' | 'skipped' | 'upgrade-available'
let _extractPhase: ExtractPhase = 'idle'
let _extractPercent = 0
let _upgradeFrom = ''
let _upgradeTo = ''
let _pendingUpgrade: { resolve: (confirmed: boolean) => void } | null = null

export function getExtractState(): {
  phase: ExtractPhase
  percent: number
  upgradeFrom?: string
  upgradeTo?: string
} {
  return {
    phase: _extractPhase,
    percent: _extractPercent,
    ...(_extractPhase === 'upgrade-available' ? { upgradeFrom: _upgradeFrom, upgradeTo: _upgradeTo } : {}),
  }
}

export function confirmUpgrade(): void {
  _pendingUpgrade?.resolve(true)
  _pendingUpgrade = null
}

export function skipUpgrade(): void {
  _pendingUpgrade?.resolve(false)
  _pendingUpgrade = null
}

// ── Worker 代码（eval CJS，每个 worker 解压一个 zip）─────────────────────────
// admZipPath 由主线程通过 workerData 传入，避免 ASAR 内模块路径解析问题
const WORKER_CODE = `
'use strict'
const { workerData, parentPort } = require('worker_threads')
const AdmZip = require(workerData.admZipPath)
const { zipPath, destDir } = workerData

const zip = new AdmZip(zipPath)
const entries = zip.getEntries().filter(e => !e.isDirectory)
const total = entries.length
const failedEntries = []

;(async () => {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    try {
      zip.extractEntryTo(entry.entryName, destDir, true, true)
    } catch (err) {
      failedEntries.push({ name: entry.entryName, error: err.message })
    }
    if (i % 80 === 0 || i === entries.length - 1) {
      parentPort.postMessage({ type: 'progress', extracted: i + 1, total, file: entry.entryName })
      await new Promise(r => setImmediate(r))
    }
  }
  parentPort.postMessage({ type: 'done', failedCount: failedEntries.length, failedEntries: failedEntries.slice(0, 20) })
})().catch(err => parentPort.postMessage({ type: 'error', message: err.message }))
`

// ── extractOpenClawIfNeeded ────────────────────────────────────────────────────
/**
 * 检查 resourcesPath/openclaw-*.zip 是否需要解压：
 * - dev 模式 / zip 不存在 → 跳过
 * - userData/.openclaw-version 与 zip 携带版本一致 → 跳过（已解压）
 * - 否则用 worker_threads 并行解压全部 zip，并通过 IPC 推送聚合进度
 *
 * 版本标记保存在 userData 而非 resources/openclaw/ 内，
 * 确保用户直接安装新版本（NSIS 覆盖安装目录）后不会触发重复解压。
 */
export async function extractOpenClawIfNeeded(
  mainWindow: BrowserWindow | null,
  resourcesPath: string
): Promise<void> {
  const ZIP_NAMES = ['openclaw-core.zip', 'openclaw-mods-a.zip', 'openclaw-mods-b.zip']
  const zipPaths = ZIP_NAMES.map(n => join(resourcesPath, n)).filter(existsSync)

  // dev 模式或未打包时不存在 zip，直接跳过
  if (zipPaths.length === 0) {
    logger.info('[Extract] no zip files found (dev mode or pre-install), skipping')
    _extractPhase = 'skipped'
    return
  }

  // openclaw 解压到 userData（%AppData%/EasiestClaw/openclaw/），而非安装目录内。
  // NSIS 升级时只替换安装目录（RMDir /r $INSTDIR），userData 不受影响，
  // 同版本 OpenClaw 升级 EasiestClaw Shell 后无需重新解压。
  //
  // zip 内部路径自带 `openclaw/` 前缀（如 openclaw/openclaw.mjs），
  // 所以 adm-zip extractEntryTo 的目标应传 userData 根目录（extractRoot），
  // 解压后自动形成 userData/openclaw/... 结构。
  const extractRoot = app.getPath('userData')
  const destDir = join(extractRoot, 'openclaw')
  const markerPath = join(extractRoot, '.openclaw-version')

  // 读取本次安装包携带的 openclaw 版本（由 bundle-openclaw.mjs 写入）
  // 用 openclaw 版本而非 app.getVersion()，避免更新 Shell 时触发不必要的重新解压
  let currentVersion: string
  const versionFilePath = join(resourcesPath, 'openclaw.version')
  try {
    currentVersion = existsSync(versionFilePath)
      ? readFileSync(versionFilePath, 'utf8').trim()
      : app.getVersion()  // 回退：旧包没有此文件时用 app 版本
  } catch {
    currentVersion = app.getVersion()
  }

  // 已解压且版本一致 → 跳过（同时验证目录和关键文件实际存在，防止解压不完整）
  const entryScriptExists =
    existsSync(join(destDir, 'easiest-claw-gateway.mjs')) ||
    existsSync(join(destDir, 'openclaw.mjs'))
  const distEntryExists = existsSync(join(destDir, 'dist', 'entry.js'))
  const entryExists = entryScriptExists && distEntryExists
  if (!distEntryExists && entryScriptExists) {
    logger.warn('[Extract] openclaw.mjs exists but dist/entry.js missing — forcing re-extraction')
  }
  if (existsSync(markerPath) && entryExists) {
    try {
      const installedVersion = readFileSync(markerPath, 'utf8').trim()
      if (installedVersion === currentVersion) {
        logger.info(`[Extract] already extracted, version matches (${currentVersion}), skipping`)
        _extractPhase = 'skipped'
        return
      }
      // 版本不同：已安装旧版，询问用户是否升级
      logger.info(`[Extract] version change detected: ${installedVersion} -> ${currentVersion}, awaiting user decision`)
      _upgradeFrom = installedVersion
      _upgradeTo = currentVersion
      _extractPhase = 'upgrade-available'
      const confirmed = await new Promise<boolean>((resolve) => {
        _pendingUpgrade = { resolve }
      })
      if (!confirmed) {
        logger.info('[Extract] user skipped upgrade, keeping installed version')
        _extractPhase = 'skipped'
        return
      }
      logger.info('[Extract] user confirmed upgrade, extracting')
    } catch {
      // 读取标记文件失败：视为首次安装，直接解压
    }
  }

  logger.info(`[Extract] extracting openclaw (${zipPaths.length} zips), target version: ${currentVersion}`)
  _extractPhase = 'extracting'
  _extractPercent = 0

  const sendProgress = (percent: number, file: string): void => {
    _extractPercent = percent
    _extractPhase = percent >= 100 ? 'done' : 'extracting'
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('openclaw:extract-progress', { percent, file })
    }
  }

  sendProgress(0, '')

  // 清除旧版本解压目录
  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true })
  }

  // 解析 adm-zip 路径（主线程可正确处理 ASAR，传给 worker 避免重复解析）
  const _require = createRequire(import.meta.url)
  const admZipPath: string = _require.resolve('adm-zip')

  // 每个 zip 的独立进度，用于聚合百分比
  const workerProgress: Record<string, { extracted: number; total: number }> = {}
  for (const zp of zipPaths) workerProgress[zp] = { extracted: 0, total: 1 }

  const workerPromises = zipPaths.map(
    (zipPath) =>
      new Promise<void>((resolve, reject) => {
        const worker = new Worker(WORKER_CODE, {
          eval: true,
          workerData: { zipPath, destDir: extractRoot, admZipPath },
        })

        worker.on('message', (msg: { type: string; extracted?: number; total?: number; file?: string; message?: string; failedCount?: number; failedEntries?: { name: string; error: string }[] }) => {
          if (msg.type === 'progress' && msg.extracted !== undefined && msg.total !== undefined) {
            workerProgress[zipPath] = { extracted: msg.extracted, total: msg.total }
            const totalExtracted = Object.values(workerProgress).reduce((s, p) => s + p.extracted, 0)
            const totalFiles = Object.values(workerProgress).reduce((s, p) => s + p.total, 0)
            const percent = totalFiles > 0 ? Math.round((totalExtracted / totalFiles) * 100) : 0
            sendProgress(Math.min(percent, 99), msg.file ?? '')
          } else if (msg.type === 'done') {
            if (msg.failedCount && msg.failedCount > 0) {
              logger.warn(`[Extract] worker done with ${msg.failedCount} failed entries: ${zipPath}`)
              for (const f of msg.failedEntries ?? []) {
                logger.warn(`[Extract]   failed: ${f.name} — ${f.error}`)
              }
            } else {
              logger.info(`[Extract] worker done: ${zipPath}`)
            }
            resolve()
          } else if (msg.type === 'error') {
            logger.error(`[Extract] worker error (${zipPath}): ${msg.message}`)
            reject(new Error(msg.message))
          }
        })

        worker.on('error', (err) => {
          logger.error(`[Extract] worker exception (${zipPath}): ${err}`)
          reject(err)
        })
        worker.on('exit', (code) => {
          if (code !== 0) {
            logger.error(`[Extract] worker exited abnormally code=${code} (${zipPath})`)
            reject(new Error(`Worker exited with code ${code}`))
          }
        })
      })
  )

  await Promise.all(workerPromises)

  // 验证关键入口文件是否存在（防止解压过程中文件被 Defender 锁住或 IO 失败导致缺失）
  const criticalFiles = [
    join(destDir, 'openclaw.mjs'),
    join(destDir, 'dist', 'entry.js'),
  ]
  const missing = criticalFiles.filter(f => !existsSync(f))
  if (missing.length > 0) {
    logger.error(`[Extract] critical files missing after extraction: ${missing.join(', ')}`)
    // 不写入版本标记，下次启动会重新解压
    sendProgress(100, '')
    throw new Error(`[Extract] critical files missing: ${missing.map(f => f.split(/[\\/]/).pop()).join(', ')}`)
  }

  // 写入版本标志到 userData（与安装目录分离，更新安装不会删掉它）
  writeFileSync(markerPath, currentVersion)
  sendProgress(100, '')
  logger.info(`[Extract] extraction complete, version marker written: ${currentVersion}`)
}


// ── sanitizeOpenClawConfig ─────────────────────────────────────────────────────
/**
 * 清理 ~/.openclaw/openclaw.json 中的无效或缺失字段，防止 gateway 启动时 Zod 校验失败。
 * 在每次 fork gateway 之前调用。
 */
export function sanitizeOpenClawConfig(): void {
  const raw = readOpenclawConfig()
  let config = { ...raw }
  let modified = false

  // ── tools.profile = 'full'（OpenClaw 3.8+ 必需）────────────────────────────
  const tools = { ...((config.tools as Record<string, unknown>) ?? {}) }
  const sessions = { ...((tools.sessions as Record<string, unknown>) ?? {}) }
  let toolsModified = false

  if (tools.profile !== 'full') {
    tools.profile = 'full'
    toolsModified = true
  }
  if (sessions.visibility !== 'all') {
    sessions.visibility = 'all'
    tools.sessions = sessions
    toolsModified = true
  }

  if (toolsModified) {
    config = { ...config, tools }
    modified = true
    console.log('[Sanitize] set tools.profile=full, tools.sessions.visibility=all')
  }

  // ── commands.restart = true（优雅重载支持）──────────────────────────────────
  const commands = { ...((config.commands as Record<string, unknown>) ?? {}) }
  if (commands.restart !== true) {
    config = { ...config, commands: { ...commands, restart: true } }
    modified = true
    console.log('[Sanitize] enabled commands.restart')
  }

  // ── skills: 删除无效根键 ─────────────────────────────────────────────────────
  const skills = config.skills
  if (isRecord(skills)) {
    const skillsObj = { ...(skills as Record<string, unknown>) }
    let skillsModified = false
    for (const key of ['enabled', 'disabled']) {
      if (key in skillsObj) {
        delete skillsObj[key]
        skillsModified = true
        console.log(`[Sanitize] removed invalid field skills.${key}`)
      }
    }
    if (skillsModified) {
      config = { ...config, skills: skillsObj }
      modified = true
    }
  }

  // ── controlUi: openclaw schema 不认识该根级键，删除 ────────────────────────────
  if ('controlUi' in config) {
    const { controlUi: _removed, ...rest } = config
    config = rest
    modified = true
    console.log('[Sanitize] removed invalid root key controlUi')
  }

  // ── agents.list[*] 中的无效字段（如 runtime）────────────────────────────────
  const agentsSection = config.agents as Record<string, unknown> | undefined
  if (agentsSection) {
    const list = agentsSection.list
    if (Array.isArray(list)) {
      const INVALID_AGENT_KEYS = ['runtime']
      let agentListModified = false
      const cleanedList = list.map((agent) => {
        if (!agent || typeof agent !== 'object') return agent
        const agentObj = agent as Record<string, unknown>
        const keysToRemove = INVALID_AGENT_KEYS.filter((k) => k in agentObj)
        if (keysToRemove.length === 0) return agent
        agentListModified = true
        const cleaned = { ...agentObj }
        for (const k of keysToRemove) {
          delete cleaned[k]
          console.log(`[Sanitize] removed invalid field in agents.list: ${k}`)
        }
        return cleaned
      })
      if (agentListModified) {
        config = { ...config, agents: { ...agentsSection, list: cleanedList } }
        modified = true
      }
    }
  }

  if (modified) {
    writeOpenclawConfig(config)
    console.log('[Sanitize] openclaw.json cleanup done')
  }
}
