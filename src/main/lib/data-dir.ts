/**
 * data-dir.ts
 *
 * 统一获取应用数据目录。
 * 支持用户在设置中自定义数据存储位置（避免 C 盘空间不足）。
 *
 * settings.json 本身始终存在 Electron 默认 userData 下（否则找不到自定义路径配置），
 * 但 openclaw 解压目录、版本标记等大文件数据可存放到自定义位置。
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { app } from 'electron'
import { logger } from './logger'

/** 不迁移的目录名（openclaw 源码，重新解压即可） */
const SKIP_MIGRATE = new Set(['openclaw'])

/**
 * 返回数据存储目录。
 * 优先级：settings.json customDataDir > 注册表 DataDir（安装器写入）> Electron 默认 userData
 */
export function getDataDir(): string {
  const defaultDir = app.getPath('userData')

  // 1. 读取 settings.json
  try {
    const settingsFile = path.join(defaultDir, 'settings.json')
    if (fs.existsSync(settingsFile)) {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
      const custom = settings.customDataDir
      if (typeof custom === 'string' && custom.trim()) {
        const resolved = path.resolve(custom.trim())
        if (fs.existsSync(resolved)) return resolved
      }
    }
  } catch {}

  // 2. 读取注册表（安装器写入的初始数据目录）
  if (process.platform === 'win32') {
    try {
      const output = execSync('reg query "HKCU\\Software\\EasiestClaw" /v DataDir', { encoding: 'utf8' })
      const match = /DataDir\s+REG_SZ\s+(.+)/.exec(output)
      if (match?.[1]) {
        const regPath = match[1].trim()
        if (regPath && fs.existsSync(regPath)) {
          // 首次启动：将注册表路径写入 settings.json
          try {
            const settingsFile = path.join(defaultDir, 'settings.json')
            let settings: Record<string, unknown> = {}
            if (fs.existsSync(settingsFile)) {
              settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
            }
            settings.customDataDir = regPath
            fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8')
            logger.info(`[DataDir] applied installer data dir: ${regPath}`)
          } catch {}
          return regPath
        }
      }
    } catch {}
  }

  return defaultDir
}

/**
 * 迁移数据到新的自定义目录。
 *
 * 在 app 启动早期（解压 openclaw 之前）调用。
 * - 读取 settings.json 中的 customDataDir 和 _migrateFrom
 * - 如果 _migrateFrom 存在且与 customDataDir 不同，执行迁移
 * - 迁移除 openclaw/ 外的所有文件和目录到新位置
 * - 迁移完成后删除旧位置已迁移的文件，清除 _migrateFrom 标记
 */
export async function migrateDataDirIfNeeded(): Promise<void> {
  const defaultDir = app.getPath('userData')
  const settingsFile = path.join(defaultDir, 'settings.json')

  let settings: Record<string, unknown>
  try {
    if (!fs.existsSync(settingsFile)) return
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
  } catch {
    return
  }

  const migrateFrom = settings._migrateFrom
  if (typeof migrateFrom !== 'string' || !migrateFrom.trim()) return

  const srcDir = path.resolve(migrateFrom.trim())
  const destDir = getDataDir()

  // 源和目标相同、或源不存在 → 清除标记并返回
  if (srcDir === destDir || !fs.existsSync(srcDir)) {
    await clearMigrateFlag(settingsFile, settings)
    return
  }

  logger.info(`[Migrate] migrating data from ${srcDir} to ${destDir} (skipping: ${[...SKIP_MIGRATE].join(', ')})`)

  // 确保目标目录存在
  await fsp.mkdir(destDir, { recursive: true })

  let entries: string[]
  try {
    entries = await fsp.readdir(srcDir)
  } catch {
    logger.warn('[Migrate] cannot read source directory, aborting')
    await clearMigrateFlag(settingsFile, settings)
    return
  }

  let migratedCount = 0
  let errorCount = 0

  for (const entry of entries) {
    if (SKIP_MIGRATE.has(entry)) continue

    const srcPath = path.join(srcDir, entry)
    const destPath = path.join(destDir, entry)

    try {
      // 如果目标已存在，先删除（覆盖）
      if (fs.existsSync(destPath)) {
        const stat = await fsp.stat(destPath)
        if (stat.isDirectory()) {
          await fsp.rm(destPath, { recursive: true, force: true })
        } else {
          await fsp.unlink(destPath)
        }
      }

      await fsp.rename(srcPath, destPath)
      migratedCount++
    } catch (renameErr) {
      // rename 跨磁盘会失败，回退到 copy + delete
      try {
        const stat = await fsp.stat(srcPath)
        if (stat.isDirectory()) {
          await copyDirRecursive(srcPath, destPath)
        } else {
          await fsp.copyFile(srcPath, destPath)
        }
        await fsp.rm(srcPath, { recursive: true, force: true })
        migratedCount++
      } catch (copyErr) {
        errorCount++
        logger.warn(`[Migrate] failed to migrate ${entry}: ${copyErr instanceof Error ? copyErr.message : copyErr}`)
      }
    }
  }

  logger.info(`[Migrate] done — migrated: ${migratedCount}, errors: ${errorCount}`)

  // 清理旧目录：删除 openclaw/（不迁移的大目录）和其他残留
  const isDefaultDir = path.resolve(srcDir) === path.resolve(defaultDir)

  // 删除跳过迁移的目录（如 openclaw/）
  for (const skip of SKIP_MIGRATE) {
    const skipPath = path.join(srcDir, skip)
    try {
      if (fs.existsSync(skipPath)) {
        await fsp.rm(skipPath, { recursive: true, force: true })
        logger.info(`[Migrate] removed skipped dir: ${skip}`)
      }
    } catch (err) {
      logger.warn(`[Migrate] failed to remove ${skip}: ${err instanceof Error ? err.message : err}`)
    }
  }

  if (isDefaultDir) {
    // 旧目录是 Electron 默认 userData — settings.json 必须保留，只清理数据文件
    // 上面 rename/copy 已经逐个移走了，openclaw/ 也已删除，无需额外操作
    logger.info('[Migrate] source is default userData, keeping directory (settings.json lives here)')
  } else {
    // 旧目录是用户自定义目录，整个删除
    try {
      await fsp.rm(srcDir, { recursive: true, force: true })
      logger.info(`[Migrate] removed old custom data dir: ${srcDir}`)
    } catch (err) {
      logger.warn(`[Migrate] failed to remove old dir: ${err instanceof Error ? err.message : err}`)
    }
  }

  // 清除迁移标记
  await clearMigrateFlag(settingsFile, settings)
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true })
  const entries = await fsp.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath)
    } else {
      await fsp.copyFile(srcPath, destPath)
    }
  }
}

async function clearMigrateFlag(settingsFile: string, settings: Record<string, unknown>): Promise<void> {
  try {
    const { _migrateFrom: _, ...rest } = settings
    await fsp.writeFile(settingsFile, JSON.stringify(rest, null, 2), 'utf8')
    logger.info('[Migrate] cleared _migrateFrom flag')
  } catch (err) {
    logger.warn(`[Migrate] failed to clear _migrateFrom: ${err instanceof Error ? err.message : err}`)
  }
}
