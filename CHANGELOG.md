# Changelog

所有值得注意的变更都记录在这里。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
`0.x.x` 版本均为测试版，在 GitHub Release 上自动标记为"预发布"。

---

## [Unreleased]

> 在这里写下一个版本的更新内容，发版时会自动提取为 Release 正文。

### 新增

-

### 修复

-

### 变更

-

---

## [0.0.3-beta] - 2026-03-14

> 在这里写下一个版本的更新内容，发版时会自动提取为 Release 正文。

### 新增

-

### 修复

-

### 变更

-

---

---

## [0.0.3-beta]

### 新增

- 应用自动更新：通过 GitHub Releases 自动检测新版本，发现更新后显示 Toast 通知，支持一键下载并重启安装

### 修复

- CI：修复 electron-builder 在 tag push 时因缺少 GH_TOKEN 导致构建失败（加 --publish never，由 softprops 统一上传）

---

## [0.0.2-beta] - 2026-03-14

> 在这里写下一个版本的更新内容，发版时会自动提取为 Release 正文。

### 新增

-

### 修复

-

### 变更

-

---

---

## [0.0.1] - 2026-03-14

### 新增

- 品牌信息统一管理：`app.config.mjs` 作为单一配置入口，`pnpm run brand` 同步到所有相关文件（`src/shared/branding.ts`、`resources/installer.nsh`、`package.json`）
- 新增 `scripts/release.mjs`：一键发版脚本，自动处理 CHANGELOG、bumping 版本号、git tag 和 push
- 新增 `scripts/extract-release-notes.mjs`：从 CHANGELOG.md 提取指定版本内容，供 CI 写入 GitHub Release 正文
- CI 自动将 git tag 版本号同步到 `package.json`，确保打包产物版本正确
- CI 自动从 CHANGELOG.md 提取对应版本内容作为 GitHub Release 正文
- `0.x.x` 版本在 GitHub Release 上自动标记为预发布（测试版）
- Provider Card 内联模型行新增视觉（Vision）切换按钮，与编辑弹窗保持一致
- API 健康检查改走主进程 IPC 代理，根据 API 类型自动选择正确认证头

### 修复

- 修复模型配置保存时丢失 `input` 字段，导致图片识别始终失败的问题
- 修复 API 健康检查在 renderer 直接 fetch 触发 CORS 报错
- 修复 Anthropic 类型 API 使用 `Authorization: Bearer` 认证头（应为 `x-api-key`）
- 修复健康检查将 HTTP 404 误判为服务不可达（`/models` 端点不存在不等于服务挂了）

### 变更

- `src/shared/branding.ts` 集中管理应用名称、AppID 等常量，main 进程和 renderer 统一引用
- `resources/installer.nsh` 改为从 `installer.nsh.template` 模板生成，不再手动编辑

---

---

