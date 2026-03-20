import { execSync } from "node:child_process"
import { basename, extname } from "node:path"
import { readFileSync, writeFileSync } from "node:fs"

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".scss",
  ".html",
  ".md",
  ".yml",
  ".yaml",
  ".sh",
  ".ps1",
  ".nsh",
  ".txt",
  ".svg",
])

const TEXT_FILENAMES = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  "Dockerfile",
  "LICENSE",
])

const IGNORE_PREFIXES = [
  "dist/",
  "out/",
  "node_modules/",
]

const REPLACEMENT_CHAR = "\uFFFD"
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const decoder = new TextDecoder("utf-8", { fatal: true })
const fixBom = process.argv.includes("--fix-bom")

function isTextFile(filePath) {
  if (IGNORE_PREFIXES.some((prefix) => filePath.startsWith(prefix))) return false
  if (filePath.startsWith(".githooks/")) return true
  const name = basename(filePath)
  if (TEXT_FILENAMES.has(name)) return true
  return TEXT_EXTENSIONS.has(extname(filePath).toLowerCase())
}

function listTrackedFiles() {
  const out = execSync("git ls-files -z", { encoding: "utf8" })
  return out.split("\0").filter(Boolean)
}

const issues = []
let fixedCount = 0

for (const file of listTrackedFiles()) {
  if (!isTextFile(file)) continue

  const raw = readFileSync(file)
  if (raw.length === 0) continue

  const hasBom = raw.length >= 3 && raw[0] === UTF8_BOM[0] && raw[1] === UTF8_BOM[1] && raw[2] === UTF8_BOM[2]
  let contentBuffer = raw
  if (hasBom) {
    if (fixBom) {
      contentBuffer = raw.subarray(3)
      writeFileSync(file, contentBuffer)
      fixedCount += 1
    } else {
      issues.push(`[BOM] ${file} 含有 UTF-8 BOM，请移除`)
      continue
    }
  }

  let text
  try {
    text = decoder.decode(contentBuffer)
  } catch {
    issues.push(`[编码] ${file} 不是有效 UTF-8`)
    continue
  }

  if (text.includes(REPLACEMENT_CHAR)) {
    issues.push(`[乱码] ${file} 包含替换字符 U+FFFD（通常表示解码损坏）`)
  }
}

if (fixedCount > 0) {
  console.log(`已自动移除 ${fixedCount} 个文件的 UTF-8 BOM`)
}

if (issues.length > 0) {
  console.error("文本编码检查失败：")
  for (const issue of issues) console.error(`- ${issue}`)
  process.exit(1)
}

console.log("文本编码检查通过：所有文本文件均为 UTF-8，且无 BOM")
