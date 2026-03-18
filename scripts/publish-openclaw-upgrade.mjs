/**
 * publish-openclaw-upgrade.mjs
 *
 * 将 pack-openclaw-upgrade.mjs 的产物发布到 GitHub Release。
 *
 * 前置条件：
 *   1. 已运行 npm run bundle:openclaw && npm run pack:openclaw-upgrade
 *   2. 已安装 gh CLI 并登录（gh auth login）
 *
 * 用法：
 *   node scripts/publish-openclaw-upgrade.mjs
 *   node scripts/publish-openclaw-upgrade.mjs --draft      # 创建草稿 Release
 *   node scripts/publish-openclaw-upgrade.mjs --prerelease # 标记为预发布
 *
 * 版本策略：
 *   - Release tag = openclaw 版本号（如 v2026.3.13）
 *   - 同一版本重复发布会先删除旧 Release 再重建
 *
 * Release 结构：
 *   Tag:    v2026.3.13
 *   Title:  OpenClaw v2026.3.13
 *   Assets: openclaw-core.zip, openclaw-mods-a.zip, openclaw-mods-b.zip, openclaw.version
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

const args = process.argv.slice(2)
const isDraft = args.includes('--draft')
const isPrerelease = args.includes('--prerelease')

// ── 读取升级包目录 ────────────────────────────────────────────────────────────
const UPGRADE_DIR = join(root, 'build', 'upgrade')
const REQUIRED_FILES = ['openclaw-core.zip', 'openclaw-mods-a.zip', 'openclaw-mods-b.zip', 'openclaw.version']

for (const f of REQUIRED_FILES) {
  if (!existsSync(join(UPGRADE_DIR, f))) {
    console.error(`[publish] ❌ 缺少文件: ${f}`)
    console.error('[publish] 请先运行: npm run bundle:openclaw && npm run pack:openclaw-upgrade')
    process.exit(1)
  }
}

const VERSION = readFileSync(join(UPGRADE_DIR, 'openclaw.version'), 'utf8').trim()
if (!VERSION) {
  console.error('[publish] ❌ 版本号为空')
  process.exit(1)
}

const TAG = `v${VERSION}`
const TITLE = `OpenClaw v${VERSION}`
const REPO = 'Zmmmmy/easiest-claw-open-claw-upgrade'

console.log(`[publish] 版本: ${VERSION}`)
console.log(`[publish] Tag: ${TAG}`)
console.log(`[publish] 仓库: ${REPO}`)
console.log(`[publish] 草稿: ${isDraft}, 预发布: ${isPrerelease}`)
console.log()

// ── 检查 gh CLI ───────────────────────────────────────────────────────────────
try {
  execSync('gh --version', { stdio: 'ignore' })
} catch {
  console.error('[publish] ❌ gh CLI 未安装，请先安装: https://cli.github.com/')
  process.exit(1)
}

// ── 检查是否已存在同版本 Release，存在则删除 ───────────────────────────────────
try {
  const existing = execSync(`gh release view ${TAG} --repo ${REPO} --json tagName`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (existing.includes(TAG)) {
    console.log(`[publish] ⚠  Release ${TAG} 已存在，正在删除...`)
    execSync(`gh release delete ${TAG} --repo ${REPO} --yes --cleanup-tag`, { stdio: 'inherit' })
    console.log(`[publish] ✓ 旧 Release 已删除`)
  }
} catch {
  // Release 不存在，正常继续
}

// ── 生成 Release Notes ────────────────────────────────────────────────────────
const NOTES = `## OpenClaw ${VERSION}

### 升级包文件

| 文件 | 说明 |
|------|------|
| \`openclaw-core.zip\` | 核心文件（dist/ + 入口脚本） |
| \`openclaw-mods-a.zip\` | 依赖包（前半） |
| \`openclaw-mods-b.zip\` | 依赖包（后半） |
| \`openclaw.version\` | 版本标记 |

### 使用方式
EasiestClaw Desktop 会自动检测此 Release 并提示升级，无需手动操作。
`

// ── 创建 Release 并上传 Assets ────────────────────────────────────────────────
const assetPaths = REQUIRED_FILES.map(f => `"${join(UPGRADE_DIR, f).replace(/\\/g, '/')}"`)

const flags = [
  `--repo ${REPO}`,
  `--title "${TITLE}"`,
  `--notes "${NOTES.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
  isDraft ? '--draft' : '',
  isPrerelease ? '--prerelease' : '',
].filter(Boolean).join(' ')

const cmd = `gh release create ${TAG} ${flags} ${assetPaths.join(' ')}`

console.log('[publish] 正在创建 Release 并上传文件...')
try {
  execSync(cmd, { stdio: 'inherit', cwd: root })
  console.log()
  console.log(`[publish] ✓ Release 发布成功!`)
  console.log(`[publish] https://github.com/${REPO}/releases/tag/${TAG}`)
} catch (e) {
  console.error(`[publish] ❌ 发布失败: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
