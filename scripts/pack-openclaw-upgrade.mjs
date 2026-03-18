/**
 * pack-openclaw-upgrade.mjs
 *
 * 将已打包好的 build/openclaw/ 目录重新压缩为 3 个 zip + 版本文件，
 * 用于上传到 GitHub Release，供客户端在线升级时直接下载解压（无需 npm install）。
 *
 * 前置条件：先运行 `npm run bundle:openclaw` 生成 build/openclaw/
 *
 * 用法：
 *   node scripts/pack-openclaw-upgrade.mjs
 *   node scripts/pack-openclaw-upgrade.mjs --out-dir dist/upgrade
 *
 * 输出（默认 build/upgrade/）：
 *   openclaw-core.zip     — dist/ + 根文件（openclaw.mjs, package.json, ...）
 *   openclaw-mods-a.zip   — node_modules 前半（按字母序）
 *   openclaw-mods-b.zip   — node_modules 后半
 *   openclaw.version      — 版本号文本文件
 *
 * zip 内部结构与 bundle-openclaw.mjs 产出的完全一致（带 openclaw/ 前缀），
 * 客户端解压逻辑（openclaw-init.ts 的 worker_threads）无需任何改动。
 */

import { existsSync, readdirSync, readFileSync, statSync, createWriteStream, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import archiver from 'archiver'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

// ── 参数解析 ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const outDirIdx = args.indexOf('--out-dir')
const OUT_DIR = outDirIdx >= 0 && args[outDirIdx + 1]
  ? args[outDirIdx + 1]
  : join(root, 'build', 'upgrade')

const OPENCLAW_DIR = join(root, 'build', 'openclaw')

// ── 前置检查 ──────────────────────────────────────────────────────────────────
if (!existsSync(join(OPENCLAW_DIR, 'openclaw.mjs'))) {
  console.error('[pack-upgrade] ❌ build/openclaw/ 不存在或不完整，请先运行: npm run bundle:openclaw')
  process.exit(1)
}

const pkgPath = join(OPENCLAW_DIR, 'package.json')
if (!existsSync(pkgPath)) {
  console.error('[pack-upgrade] ❌ build/openclaw/package.json 不存在')
  process.exit(1)
}

const VERSION = JSON.parse(readFileSync(pkgPath, 'utf8')).version
if (!VERSION) {
  console.error('[pack-upgrade] ❌ 无法读取 openclaw 版本号')
  process.exit(1)
}

console.log(`[pack-upgrade] openclaw 版本: ${VERSION}`)
console.log(`[pack-upgrade] 源目录: ${OPENCLAW_DIR}`)
console.log(`[pack-upgrade] 输出目录: ${OUT_DIR}`)

// ── 准备输出目录 ──────────────────────────────────────────────────────────────
if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

// ── node_modules 拆分 ─────────────────────────────────────────────────────────
const nmDir = join(OPENCLAW_DIR, 'node_modules')
const nmEntries = existsSync(nmDir)
  ? readdirSync(nmDir).filter(n => n !== '.package-lock.json')
  : []

const mid = Math.ceil(nmEntries.length / 2)
const nmA = nmEntries.slice(0, mid)
const nmB = nmEntries.slice(mid)

// ── zip 打包工具 ──────────────────────────────────────────────────────────────
function createZipAsync(zipPath, builder) {
  if (existsSync(zipPath)) rmSync(zipPath, { force: true })
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 6 } })
    output.on('close', () => resolve(archive.pointer()))
    archive.on('warning', (err) => { if (err.code !== 'ENOENT') reject(err) })
    archive.on('error', reject)
    archive.pipe(output)
    builder(archive)
    archive.finalize()
  })
}

// ── 并行压缩 3 个 zip ────────────────────────────────────────────────────────
const CORE_ZIP = join(OUT_DIR, 'openclaw-core.zip')
const MODS_A_ZIP = join(OUT_DIR, 'openclaw-mods-a.zip')
const MODS_B_ZIP = join(OUT_DIR, 'openclaw-mods-b.zip')

console.log(`[pack-upgrade] 并行压缩 3 个 zip (level=6)...`)
console.log(`[pack-upgrade]   core  : dist/ + 根文件`)
console.log(`[pack-upgrade]   mods-a: node_modules [0..${mid - 1}] (${nmA.length} 包)`)
console.log(`[pack-upgrade]   mods-b: node_modules [${mid}..] (${nmB.length} 包)`)

const [sizeCore, sizeA, sizeB] = await Promise.all([
  // ── core: 所有非 node_modules 的顶层条目 ────────────────────────────────────
  createZipAsync(CORE_ZIP, (archive) => {
    for (const name of readdirSync(OPENCLAW_DIR)) {
      if (name === 'node_modules') continue
      const p = join(OPENCLAW_DIR, name)
      if (statSync(p).isDirectory()) {
        archive.directory(p, `openclaw/${name}`)
      } else {
        archive.file(p, { name: `openclaw/${name}` })
      }
    }
  }),
  // ── mods-a: 前半 node_modules ───────────────────────────────────────────────
  createZipAsync(MODS_A_ZIP, (archive) => {
    for (const pkg of nmA) {
      const p = join(nmDir, pkg)
      if (!existsSync(p)) continue
      if (statSync(p).isDirectory()) {
        archive.directory(p, `openclaw/node_modules/${pkg}`)
      } else {
        archive.file(p, { name: `openclaw/node_modules/${pkg}` })
      }
    }
  }),
  // ── mods-b: 后半 node_modules ───────────────────────────────────────────────
  createZipAsync(MODS_B_ZIP, (archive) => {
    for (const pkg of nmB) {
      const p = join(nmDir, pkg)
      if (!existsSync(p)) continue
      if (statSync(p).isDirectory()) {
        archive.directory(p, `openclaw/node_modules/${pkg}`)
      } else {
        archive.file(p, { name: `openclaw/node_modules/${pkg}` })
      }
    }
  }),
])

// ── 写入版本文件 ──────────────────────────────────────────────────────────────
writeFileSync(join(OUT_DIR, 'openclaw.version'), VERSION)

// ── 输出摘要 ──────────────────────────────────────────────────────────────────
const fmtMB = (b) => (b / 1024 / 1024).toFixed(1)
console.log()
console.log(`[pack-upgrade] ✓ openclaw-core.zip   ${fmtMB(sizeCore)} MB`)
console.log(`[pack-upgrade] ✓ openclaw-mods-a.zip ${fmtMB(sizeA)} MB`)
console.log(`[pack-upgrade] ✓ openclaw-mods-b.zip ${fmtMB(sizeB)} MB`)
console.log(`[pack-upgrade] ✓ openclaw.version    ${VERSION}`)
console.log()
console.log(`[pack-upgrade] 完成！将以下 4 个文件上传到 GitHub Release:`)
console.log(`  ${CORE_ZIP}`)
console.log(`  ${MODS_A_ZIP}`)
console.log(`  ${MODS_B_ZIP}`)
console.log(`  ${join(OUT_DIR, 'openclaw.version')}`)
