/**
 * bundle-openclaw.mjs
 *
 * 用 npm 将 openclaw 及其所有运行时依赖安装到临时目录，
 * 再拍平为 build/openclaw/（与原 resources/openclaw/ 结构完全相同）：
 *
 *   build/openclaw/
 *   ├── openclaw.mjs          ← 入口脚本
 *   ├── package.json
 *   └── node_modules/         ← 所有运行时依赖（平铺）
 *
 * 本地模式（../openclaw 目录存在）：
 *   npm pack 打成 tarball → TMP 里 npm install tarball → 走与注册表相同的拍平流程。
 *   避免 file: 依赖在 Windows 上创建符号链接，也不触发 openclaw 自身的 prepare 脚本。
 *
 * 注册表模式（本地源不存在）：
 *   直接 npm install openclaw@VERSION，拍平到 OUT。
 */

import { execSync, spawnSync } from 'child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, cpSync, createWriteStream, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import archiver from 'archiver'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

// ── 优先使用本地 openclaw 源（../openclaw），不存在时回退到 npm 注册表 ──────────
const LOCAL_SRC = join(root, '..', 'openclaw')
const localSrcExists = existsSync(join(LOCAL_SRC, 'package.json'))
const sourceModeRaw = String(process.env.OPENCLAW_SOURCE ?? 'npm').trim().toLowerCase()
const sourceMode = sourceModeRaw === 'local' || sourceModeRaw === 'npm' || sourceModeRaw === 'auto'
  ? sourceModeRaw
  : 'npm'

if (sourceMode === 'local' && !localSrcExists) {
  throw new Error(`[bundle-openclaw] OPENCLAW_SOURCE=local, but local source not found: ${LOCAL_SRC}`)
}

const useLocal = sourceMode === 'local' ? true : sourceMode === 'npm' ? false : localSrcExists

let VERSION = '2026.3.12'
if (useLocal) {
  try {
    const pkg = JSON.parse(readFileSync(join(LOCAL_SRC, 'package.json'), 'utf8'))
    if (pkg.version) VERSION = pkg.version
  } catch { /* 读取失败保留默认版本号 */ }
}

const REGISTRY = process.env.npm_config_registry ?? 'https://registry.npmmirror.com'
const TMP = join(root, 'build', '_openclaw_tmp')
const OUT = join(root, 'build', 'openclaw')
const BUNDLE_META_FILE = join(OUT, '.bundle-meta.json')

console.log(`[bundle-openclaw] source mode=${sourceMode}, resolved=${useLocal ? 'local' : 'npm'}`)

// ── 真实阻塞睡眠（Atomics.wait，不占用 CPU）────────────────────────────────────
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// ── Windows 下 EBUSY 重试删除（Windows Defender 扫描 node_modules 时会持续锁文件）
// 使用 spawnSync 直接传参调用 cmd.exe，避免 shell 转义问题；
// 每次重试间隔 30s，最多等 ~5 分钟，通常 Defender 会在此之前完成扫描。
function rmSyncWithRetry(p, maxRetries = 10, delayMs = 30_000) {
  for (let i = 0; i <= maxRetries; i++) {
    if (!existsSync(p)) return
    try {
      if (process.platform === 'win32') {
        spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', p.replace(/\//g, '\\')], { stdio: 'ignore' })
      } else {
        rmSync(p, { recursive: true, force: true })
        return
      }
    } catch { /* ignore errors, check existence below */ }
    if (!existsSync(p)) return
    if (i < maxRetries) {
      const waitSec = Math.round(delayMs / 1000)
      console.log(`[bundle-openclaw] ⏳ 目录被占用（Defender 扫描中），等待 ${waitSec}s 后重试 (${i + 1}/${maxRetries})...`)
      sleepSync(delayMs)
    }
  }
  // 超时后最后一次尝试 Node rmSync（会抛错，让外层感知）
  if (existsSync(p)) rmSync(p, { recursive: true, force: true })
}

// ── 清理旧产物 ─────────────────────────────────────────────────────────────────
if (existsSync(TMP)) rmSyncWithRetry(TMP)
if (existsSync(OUT)) rmSyncWithRetry(OUT)
mkdirSync(TMP, { recursive: true })

// ── libsignal-node stub（WhatsApp 插件的 git 依赖，国内无法访问 GitHub）─────────
const libsignalStubDir = join(TMP, '_stubs', 'libsignal-node')
mkdirSync(libsignalStubDir, { recursive: true })
writeFileSync(
  join(libsignalStubDir, 'package.json'),
  JSON.stringify({ name: 'libsignal-node', version: '5.0.0', main: 'index.js' })
)
writeFileSync(join(libsignalStubDir, 'index.js'), 'module.exports = {};\n')
const stubPath = libsignalStubDir.replace(/\\/g, '/')

writeFileSync(
  join(TMP, 'package.json'),
  JSON.stringify({
    name: '_openclaw_bundle',
    version: '1.0.0',
    private: true,
    overrides: { 'libsignal-node': `file:${stubPath}` },
  })
)

// ── 安装 openclaw ──────────────────────────────────────────────────────────────
if (useLocal) {
  // 用 npm pack 把本地源打成 tarball（只含 package.json files 声明的文件，干净分发包）
  console.log(`[bundle-openclaw] 使用本地源 ${LOCAL_SRC} (v${VERSION})`)
  console.log('[bundle-openclaw] 打包本地源为 tarball（npm pack --ignore-scripts）...')
  // Windows 下 npm pack 会强制执行 prepare 生命周期（--ignore-scripts 无法阻止），
  // openclaw 的 prepare 脚本使用 bash 语法（/dev/null），在 cmd.exe 下会报
  // "系统找不到指定的路径"（无害，|| exit 0 保证退出码为 0）。
  // 若系统有 Git Bash，设置 script-shell 可消除该警告。
  const gitBash = process.platform === 'win32'
    ? (() => {
        try {
          const gitExe = execSync('where git', { encoding: 'utf8' }).trim().split('\n')[0].trim()
          // C:\Program Files\Git\cmd\git.exe → C:\Program Files\Git\bin\bash.exe
          const bash = gitExe.replace(/\\cmd\\git\.exe$/i, '\\bin\\bash.exe')
          if (bash !== gitExe && existsSync(bash)) return bash
        } catch { /* git not found */ }
        return null
      })()
    : null
  const packEnv = gitBash
    ? { ...process.env, npm_config_script_shell: gitBash }
    : process.env
  execSync(
    `npm pack --pack-destination ${TMP} --ignore-scripts`,
    { cwd: LOCAL_SRC, stdio: 'inherit', env: packEnv }
  )
  const tarball = readdirSync(TMP).find((f) => f.endsWith('.tgz'))
  if (!tarball) throw new Error('[bundle-openclaw] npm pack 失败：未找到 .tgz 文件')

  console.log(`[bundle-openclaw] 安装 tarball: ${tarball}`)
  execSync(
    `npm install ${join(TMP, tarball).replace(/\\/g, '/')} --registry ${REGISTRY} --no-audit --no-fund --ignore-scripts`,
    { cwd: TMP, stdio: 'inherit' }
  )
} else {
  console.log(`[bundle-openclaw] 正在从 npm 安装 openclaw@${VERSION}...`)
  execSync(
    `npm install openclaw@${VERSION} --registry ${REGISTRY} --no-audit --no-fund`,
    { cwd: TMP, stdio: 'inherit' }
  )
}

// ── 把 openclaw 源码拷到 OUT 根（含自身 node_modules 若有）────────────────────
console.log('[bundle-openclaw] 拼装目录结构...')
const openclawSrc = join(TMP, 'node_modules', 'openclaw')
cpSync(openclawSrc, OUT, { recursive: true, dereference: true })

// ── 本地模式：确保 dist/ 有内容（npm pack 打包时若源码 dist/ 未被正确纳入则补充）──
if (useLocal) {
  const outDist = join(OUT, 'dist')
  const srcDist = join(LOCAL_SRC, 'dist')
  const distEmpty = !existsSync(outDist) || readdirSync(outDist).length === 0
  if (distEmpty && existsSync(srcDist) && readdirSync(srcDist).length > 0) {
    console.log('[bundle-openclaw] ⚠  dist/ 为空，从本地源直接补充...')
    mkdirSync(outDist, { recursive: true })
    cpSync(srcDist, outDist, { recursive: true, dereference: true })
    console.log('[bundle-openclaw] ✓ dist/ 补充完成')
  }
}

// ── 把 openclaw 的依赖（TMP/node_modules/*）拷到 OUT/node_modules/ ────────────
const outMods = join(OUT, 'node_modules')
mkdirSync(outMods, { recursive: true })

for (const pkg of readdirSync(join(TMP, 'node_modules'))) {
  if (pkg === 'openclaw') continue
  if (pkg === '.package-lock.json') continue
  const dest = join(outMods, pkg)
  if (existsSync(dest)) continue
  cpSync(join(TMP, 'node_modules', pkg), dest, { recursive: true, dereference: true })
}


// ── 本地模式：用本地源自身的 @mariozechner/* 覆盖 npm 安装的版本 ─────────────────
// 背景：openclaw dist 编译时使用的是 node_modules/ 里的实际版本，
//       但 package.json 里写的版本可能不同步（如 @mariozechner/pi-ai 0.55.3 vs 0.57.1）。
if (useLocal) {
  const localModzScope = join(LOCAL_SRC, 'node_modules', '@mariozechner')
  if (existsSync(localModzScope)) {
    const scopeOut = join(outMods, '@mariozechner')
    mkdirSync(scopeOut, { recursive: true })
    for (const pkg of readdirSync(localModzScope)) {
      const src = join(localModzScope, pkg)
      const dest = join(scopeOut, pkg)
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
      cpSync(src, dest, { recursive: true, dereference: true })
      const ver = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version
      console.log(`[bundle-openclaw] ✓ 覆盖 @mariozechner/${pkg}@${ver}（来自本地源）`)
    }
  }
}

// ── 清理临时目录 ───────────────────────────────────────────────────────────────
rmSyncWithRetry(TMP)

// ── 删除运行时不需要的大型包（减小安装包体积）────────────────────────────────────
const UNUSED_LARGE_PKGS = [
  'koffi',            // ~87 MB  — native binding，本应用不用
  'pdfjs-dist',       // ~40 MB  — PDF 渲染，本应用不用
  'node-llama-cpp',   // ~32 MB  — 本地 LLM，本应用不用
  '@node-llama-cpp',  // ~  ?    — 同上（作用域包）
  'playwright-core',  // ~10 MB  — 浏览器自动化，本应用不用
  '@playwright',      // ~  ?    — 同上（作用域包）
  'typescript',       // ~  ?    — 编译器，运行时不需要
  '@cloudflare',      // ~  ?    — Cloudflare SDK
]
for (const pkg of UNUSED_LARGE_PKGS) {
  const p = join(outMods, pkg)
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true })
    console.log(`[bundle-openclaw] 🗑  已删除 ${pkg}`)
  }
}

// ── 写入 Windows 黑窗口修复包装脚本 ───────────────────────────────────────────
writeFileSync(join(OUT, 'easiest-claw-gateway.mjs'), `/**
 * easiest-claw-gateway.mjs — EasiestClaw 包装入口
 * 在 Windows 上 patch child_process，然后启动真正的 OpenClaw Gateway。
 */
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

process.env.pm_exec_path = join(dirname(fileURLToPath(import.meta.url)), 'dist', 'entry.js')

if (process.platform === 'win32') {
  const require = createRequire(import.meta.url)
  const cp = require('child_process')

  const _spawn = cp.spawn
  cp.spawn = function (cmd, args, opts) {
    if (!Array.isArray(args)) { opts = args; args = [] }
    return _spawn.call(this, cmd, args, Object.assign({ windowsHide: true }, opts || {}))
  }

  const _spawnSync = cp.spawnSync
  cp.spawnSync = function (cmd, args, opts) {
    if (!Array.isArray(args)) { opts = args; args = [] }
    return _spawnSync.call(this, cmd, args, Object.assign({ windowsHide: true }, opts || {}))
  }

  const _execFile = cp.execFile
  cp.execFile = function (file, args, opts, cb) {
    if (typeof args === 'function') { cb = args; args = []; opts = {} }
    else if (!Array.isArray(args)) { cb = opts; opts = typeof args === 'object' ? args : {}; args = [] }
    else if (typeof opts === 'function') { cb = opts; opts = {} }
    return _execFile.call(this, file, args, Object.assign({ windowsHide: true }, opts || {}), cb)
  }

  const _exec = cp.exec
  cp.exec = function (cmd, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {} }
    return _exec.call(this, cmd, Object.assign({ windowsHide: true }, opts || {}), cb)
  }

  const _execSync = cp.execSync
  cp.execSync = function (cmd, opts) {
    return _execSync.call(this, cmd, Object.assign({ windowsHide: true }, opts || {}))
  }
}

await import('./openclaw.mjs')
`)
console.log('[bundle-openclaw] ✓ easiest-claw-gateway.mjs 已写入')

// ── 打包为 3 个 ZIP 并行压缩（core + mods-a + mods-b）────────────────────────
// core: dist/ + 根文件（不含 node_modules）
// mods-a/b: node_modules 按包名字母序均分为两半
// 三个 zip 同时写入，利用多核 IO；解压时也可并行
const nmEntries = readdirSync(join(OUT, 'node_modules')).filter(n => n !== '.package-lock.json')
const mid = Math.ceil(nmEntries.length / 2)
const nmA = nmEntries.slice(0, mid)
const nmB = nmEntries.slice(mid)

function createZipAsync(zipPath, builder) {
  rmSync(zipPath, { force: true })
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

const CORE_ZIP  = join(root, 'build', 'openclaw-core.zip')
const MODS_A_ZIP = join(root, 'build', 'openclaw-mods-a.zip')
const MODS_B_ZIP = join(root, 'build', 'openclaw-mods-b.zip')

console.log(`[bundle-openclaw] 并行压缩 3 个 zip（core + mods×2, level=6）...`)
console.log(`[bundle-openclaw]   core  : dist/ + 根文件`)
console.log(`[bundle-openclaw]   mods-a: node_modules [0..${mid - 1}] (${nmA.length} 包)`)
console.log(`[bundle-openclaw]   mods-b: node_modules [${mid}..] (${nmB.length} 包)`)

const [sizeCore, sizeA, sizeB] = await Promise.all([
  // ── core：所有非 node_modules 的顶层条目 ───────────────────────────────────
  createZipAsync(CORE_ZIP, (archive) => {
    for (const name of readdirSync(OUT)) {
      if (name === 'node_modules') continue
      const p = join(OUT, name)
      if (statSync(p).isDirectory()) {
        archive.directory(p, `openclaw/${name}`)
      } else {
        archive.file(p, { name: `openclaw/${name}` })
      }
    }
  }),
  // ── mods-a：前半 node_modules ─────────────────────────────────────────────
  createZipAsync(MODS_A_ZIP, (archive) => {
    for (const pkg of nmA) {
      const p = join(OUT, 'node_modules', pkg)
      if (!existsSync(p)) continue
      if (statSync(p).isDirectory()) {
        archive.directory(p, `openclaw/node_modules/${pkg}`)
      } else {
        archive.file(p, { name: `openclaw/node_modules/${pkg}` })
      }
    }
  }),
  // ── mods-b：后半 node_modules ─────────────────────────────────────────────
  createZipAsync(MODS_B_ZIP, (archive) => {
    for (const pkg of nmB) {
      const p = join(OUT, 'node_modules', pkg)
      if (!existsSync(p)) continue
      if (statSync(p).isDirectory()) {
        archive.directory(p, `openclaw/node_modules/${pkg}`)
      } else {
        archive.file(p, { name: `openclaw/node_modules/${pkg}` })
      }
    }
  }),
])

// ── 写入 openclaw 版本文件（供 openclaw-init.ts 解压标记使用）────────────────────
// 用 openclaw 版本而非 app 版本做标记，这样更新 Electron Shell 但 openclaw 未变时
// 不会触发重复解压
writeFileSync(join(root, 'build', 'openclaw.version'), VERSION)
console.log(`[bundle-openclaw] ✓ openclaw.version = ${VERSION}`)

const fmtMB = (b) => (b / 1024 / 1024).toFixed(1)
const bundleMeta = {
  source: useLocal ? 'local' : 'npm',
  requestedSource: sourceMode,
  openclawVersion: VERSION,
  registry: REGISTRY,
  builtAt: new Date().toISOString(),
}
writeFileSync(BUNDLE_META_FILE, JSON.stringify(bundleMeta, null, 2) + '\n', 'utf8')
console.log(`[bundle-openclaw] ✓ openclaw-core.zip   (${fmtMB(sizeCore)} MB)`)
console.log(`[bundle-openclaw] ✓ openclaw-mods-a.zip (${fmtMB(sizeA)} MB)`)
console.log(`[bundle-openclaw] ✓ openclaw-mods-b.zip (${fmtMB(sizeB)} MB)`)
console.log(`[bundle-openclaw] 完成 → ${OUT}`)
