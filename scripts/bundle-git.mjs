#!/usr/bin/env node
/**
 * bundle-git.mjs — 下载 MinGit（Windows 最小 Git 分发）到 resources/git/win/
 *
 * 只在 Windows 上有效（CI build-win 步骤自动调用）。
 * macOS / Linux 有系统 git，无需内置。
 */

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const GIT_VER = '2.47.0'
const DEST = join(root, 'resources', 'git', 'win')

if (process.platform !== 'win32') {
  console.log('[bundle-git] 非 Windows，跳过')
  process.exit(0)
}

const gitExe = join(DEST, 'cmd', 'git.exe')
if (existsSync(gitExe)) {
  console.log(`[bundle-git] MinGit 已存在于 ${DEST}，跳过`)
  process.exit(0)
}

await mkdir(DEST, { recursive: true })
await mkdir(join(root, 'build'), { recursive: true })

const url = `https://github.com/git-for-windows/git/releases/download/v${GIT_VER}.windows.1/MinGit-${GIT_VER}-64-bit.zip`
const zipPath = join(root, 'build', 'mingit.zip')

console.log(`[bundle-git] 下载 MinGit ${GIT_VER}...`)
execSync(
  `powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath}'"`,
  { stdio: 'inherit' }
)

console.log(`[bundle-git] 解压到 ${DEST}...`)
execSync(
  `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${DEST}' -Force"`,
  { stdio: 'inherit' }
)

execSync(`del /f "${zipPath}"`, { shell: true })
console.log(`[bundle-git] ✓ MinGit ${GIT_VER} 就绪：${DEST}`)
