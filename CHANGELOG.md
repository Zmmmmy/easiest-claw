# Changelog

所有值得注意的变更都记录在这里。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
`0.x.x` 版本均为测试版，在 GitHub Release 上自动标记为"预发布"。

---

## [Unreleased]

> 在这里写下一个版本的更新内容，发版时会自动提取为 Release 正文。

### 修复

- 修复压缩上下文提示一直不消失的问题（改为 10 秒自动关闭，支持手动关闭）

---

## [0.0.28-beta] - 2026-03-18

### 新增

- 技能市场接入 Skills.sh，支持浏览热门技能、搜索和一键安装
- 已安装技能列表新增搜索过滤功能
- 已安装技能详情弹窗，可查看技能文件及内容
- 聊天消息支持展示思考过程（thinking blocks）和工具调用详情
- 新增历史会话面板，可浏览和切换过往会话

### 修复

- 修复首次安装时重命名默认 Agent 报错 `agent "main" not found`
- 修复内置/bundled 技能无法查看文件的问题

### 变更

- 技能市场数据源从 ClawHub API 迁移至 Skills.sh

---

---

## [0.0.27-beta] - 2026-03-17

### 修复

- 首次启动设置完用户信息后，模型配置步骤白屏（onDone 引用不稳定 + configured 时 return null）
- 添加 AppErrorBoundary 防止未捕获 React 错误导致白屏
- Dialog/Select 弹出层在 onboarding 拖拽区域内点击无响应（Portal 内容缺少 no-drag）

### 变更

-

---

---

## [0.0.26-beta] - 2026-03-17

### 新增

- ClawHub 技能市场：浏览、搜索、一键安装社区技能（基于 `npx clawhub install`）
- 工作空间面板完整文件树：递归显示所有文件/文件夹，支持展开折叠
- 文件可用系统默认应用打开（悬停显示外部链接按钮）
- 引导流程新增模型配置检测步骤，未配置时提示配置或跳过
- 设置按钮及模型配置项红点提醒（未配置模型时显示）

### 修复

- 会话列表空白闪烁问题
- gateway 事件字段兼容性（agentId fallback）

### 变更

- i18n 精简：仅保留简体中文（zh-CN）和英语（en），移除其他 8 种语言

---

---

## [0.0.25-beta] - 2026-03-16

### 新增

- 新增飞书 & Telegram 渠道配置页面，支持可视化配置 appId/appSecret/botToken 等参数
- 聊天页新增工作区面板（WorkspacePanel），展示智能体文件列表
- Windows 窗口关闭按钮增加二次确认弹窗，防止误关

### 修复

- 修复智能体详情面板模型显示"未配置"：改用 openclawModelsGet API 获取正确的模型信息
- 修复智能体详情面板工具列表过长时溢出：改为可折叠展示（默认显示前 5 个）
- 修复 OpenClaw 首次安装时解压健壮性不足导致 dist/entry.js 缺失
- 修复 macOS 红绿灯按钮与搜索栏重叠
- 修复启动页 loading spinner 旋转偏心

---

---

## [0.0.24-beta] - 2026-03-16

### 新增

- 智能体配置新增「记忆」标签页，支持查看/编辑长期记忆（MEMORY.md）和浏览每日记忆日志
- 智能体侧边信息面板新增记忆摘要展示
- 启动页补偿加载渲染前已输出的 Gateway 日志，避免日志丢失

### 变更

- NSIS 安装器改用 `nsExec::ExecToStack` 替代 `ExecToLog`，隐藏安装详情面板（nevershow），优化安装体验
- 安装器模板输出改为 UTF-8 BOM 编码，修复 NSIS Unicode 模式下中文乱码

---

---

## [0.0.23-beta] - 2026-03-15

### 新增

- 设置页新增「Gateway」配置面板，支持配置网关连接 URL 和访问令牌
- 关于页面新增 OpenClaw 更新面板（从 OpenClaw 状态页迁移）

### 修复

- 修复开发控制台中文日志乱码：主进程所有中文日志消息改为英文，避免 Windows GBK 终端编码不匹配
- 修复启动时 Gateway 未就绪即尝试连接产生大量 ECONNREFUSED 重连：改为串行等待 gateway 启动完成后再启动 runtime

### 变更

- 精简 OpenClaw 状态页：移除 AI 团队（agent 列表）部分，保留核心的连接状态、环境信息和日志面板
- 启动时序优化：防火墙规则与 OpenClaw 解压改为并行执行，端口探测从 1.5s 轮询缩短为 300ms 单次探测
- 未连接 Gateway 前始终显示品牌启动封面（GatewayLoadingScreen），不再闪现空白聊天页

---

---

## [0.0.22-beta] - 2026-03-15

### 修复

- 修复 `openclaw-init.ts` 解压 worker 的目标路径错误：worker 接收的 `destDir` 仍为 `resourcesPath` 而非 `extractRoot`（userData），导致 zip 解压到安装目录而非用户数据目录

### 变更

- 重构 OpenClaw 程序内升级流程：改为直接下载 tarball（HTTP）+ 原子 rename 复用旧 node_modules + 增量 npm install，大幅缩短升级耗时
- 升级步骤从 7 步精简为 5 步（下载 → 安装 → 停止 → 迁移 → 启动），前端进度展示同步更新
- 提取 `src/main/lib/openclaw-paths.ts` 统一管理 OpenClaw 路径查找和共享常量，消除三处重复路径逻辑
- 修复 `ensureOpenclawDependencies` 中使用同步 I/O（`readFileSync`/`writeFileSync`）阻塞主进程事件循环的问题

---

---

## [0.0.21-beta] - 2026-03-15

### 修复

- 修复 OpenClaw 升级过程中切换页面后进度和日志全部消失的问题：主进程现在持久化升级每步的状态和日志，gateway 进程输出也缓存最近 500 行，切换回 OpenClaw 页面时自动恢复完整的升级进度和日志面板

---

---

## [0.0.20-beta] - 2026-03-15

### 修复

- 修复升级 EasiestClaw 时每次都重新解压 OpenClaw 的问题：将解压目标从安装目录（resources/openclaw/）改为用户数据目录（AppData/EasiestClaw/openclaw/），NSIS 升级安装不会清除用户数据目录，同版本 OpenClaw 只需首次安装时解压一次

---

---

## [0.0.19-beta] - 2026-03-15

### 修复

- 彻底重构程序内升级 OpenClaw 流程，确保健壮性：下载阶段 gateway 继续运行（用户无感知），下载完成后暂存到同盘目录，验证通过后再停止 gateway，最后原子 rename 完成备份+迁移，启动失败时自动回滚至旧版本
- 修复升级时 gateway 停止后端口未完全释放即开始文件操作的问题：新增严格端口释放等待（最长 15s），超时则中止升级并恢复 gateway
- 修复 gateway 进程退出事件竞态：升级重启场景下旧进程 exit 事件不再覆盖新进程引用，避免触发虚假自动重启导致端口冲突

---

## [0.0.18-beta] - 2026-03-15

### 修复

- 彻底修复程序内升级 OpenClaw 在 Windows 上因 git 命令失败导致 npm install 报错（ENOENT/EINVAL）：改为随应用内置 MinGit（Git for Windows 最小分发），通过 `npm_config_git` 指向内置 `git.exe`，不再依赖系统 git 也不再使用任何 fake git 脚本

### 变更

-

---

---

## [0.0.17-beta] - 2026-03-15

### 修复

- 彻底修复程序内升级 OpenClaw 时因系统未安装 git 导致 npm install 失败（ENOENT）：重新引入 fake git 注入机制，同时通过 PATH 前置和 npm_config_git 环境变量双重保障，确保 npm 10 的 git 探测不会中断安装流程

---

---

## [0.0.16-beta] - 2026-03-15

### 修复

- 彻底重写 OpenClaw 程序内升级策略：改为与打包脚本完全相同的机制——用内置 npm 在临时目录执行 `npm install openclaw@version`（libsignal-node 用 stub override），从根本上解决新增依赖（如 `@modelcontextprotocol/sdk`）缺失问题
- 改进启动时依赖检查：改为版本感知（openclaw 版本变化才重跑 npm install），而不是逐包检查，避免检查逻辑遗漏未在本地 package.json 列出的依赖

### 变更

-

---

---

## [0.0.15-beta] - 2026-03-15

### 修复

- 修复应用启动时因上次程序内升级未补全依赖导致 Gateway 报 ERR_MODULE_NOT_FOUND：启动前自动检测 node_modules 中的缺失包，有缺失则先用内置 npm 补装再 fork Gateway

### 变更

-

---

---

## [0.0.14-beta] - 2026-03-15

### 修复

- 修复 OpenClaw 升级后新增依赖（如 @modelcontextprotocol/sdk）缺失导致 Gateway 启动报 ERR_MODULE_NOT_FOUND：升级时用内置 npm 补装新依赖，--omit=optional 跳过 libsignal 等 git URL 依赖
- 修复 Release 正文中出现空的「新增」「变更」节：发版和 CI 提取脚本现在自动过滤只有占位符 `-` 的空小节

### 变更

-

---

---

## [0.0.13-beta] - 2026-03-15

### 修复

- 修复 OpenClaw 升级后 Gateway 重启超时（30s → 90s），避免首次启动需要 26s+ 的机器升级必定失败
- 修复 Gateway 升级重启超时被误报为升级失败；超时现在视为软警告，升级正常完成
- 修复 Gateway 异常退出（code=0）后无法自动恢复：新增最多 5 次自动重启，间隔 3s，5 分钟无重启则重置计数

---

## [0.0.12-beta] - 2026-03-15

### 新增

- OpenClaw 页面新增「Gateway 运行日志」卡片，实时显示 Gateway 进程输出，有 stderr 时自动展开，方便排查启动失败原因

---

---

## [0.0.11-beta] - 2026-03-15

### 修复

- 修复程序内升级 OpenClaw 时 npm install 调用 git 失败的问题：改为直接复用现有 node_modules，彻底绕过 git URL 依赖限制
- 修复 release.mjs 发版时将模板提示行（`> 在这里写下...`）误当有效内容写入版本正文

---

---

## [0.0.10-beta] - 2026-03-15

### 修复

- 修复 OpenClaw 升级时 fake git 不生效（git.cmd 路径含双反斜杠导致 ENOENT），同时补全对 optionalDependencies 中 git URL 依赖的 stub 替换
- 修复应用更新进度条卡在 0%（available 状态误提前 unsubscribe，下载事件收不到）
- 修复应用更新下载时顶部 toast 与设置页进度条重复显示

---

## [0.0.9-beta] - 2026-03-15

### 修复

- 彻底修复 OpenClaw 升级时因系统未安装 git 导致 npm install 失败的问题：注入临时目录的假 git 脚本到 PATH，拦截 npm 对 git 的所有调用（ls-remote/clone），全程无需系统 git
- 修复 macOS CI 构建因缺少 `contents: write` 权限导致 GitHub Release 上传 403 报错

---

## [0.0.8-beta] - 2026-03-14

### 新增

- 使用 Dexie.js (IndexedDB) 替换 localStorage 图片附件缓存，存储上限从 5-10MB 提升至 GB 级，重启应用后图片可恢复

### 修复

- 修复 DM 对话中发送的图片重启后消失的问题（OpenClaw 128KB 限制导致历史记录中图片被剥离）
- 修复图片附件添加到输入框时文本区域被压缩至极小高度的问题
- 修复 OpenClaw 升级失败时错误日志消失、无法排查原因的问题；镜像源失败时自动 fallback 到官方 npm 源
- 修复 NSIS 升级安装时弹出用户数据清理确认框的问题

### 变更

- macOS 构建移除 Intel x64（macOS 13）版本，仅保留 Apple Silicon (arm64)

---

---

## [0.0.7-beta] - 2026-03-14

### 修复

- 修复 NSIS 升级安装后内置 OpenClaw 无法启动：版本标记残留但解压目录已被清除，跳过逻辑新增对入口脚本实际存在的校验，确保目录缺失时重新解压

---

---

## [0.0.6-beta] - 2026-03-14

### 新增

- 聊天输入框支持拖拽调整高度，最高不超过对话框的 1/3
- 新增停止生成按钮，可中止当前 AI 对话
- 输入框支持斜杠命令（/command）自动补全提示
- 消息发送队列：AI 生成中可预排最多 3 条消息，生成结束后自动依次发出

### 修复

- 修复网关启动日志和解压日志中 ANSI 颜色转义码显示为乱码的问题
- 修复窗口最大化状态监听器的内存泄漏（useEffect cleanup 函数未正确注销）

### 变更

- 移除输入框工具栏中的无用占位按钮（格式、快捷指令、更多、展开）及分割线
- 各平台安装包文件名统一规范为 `${productName}-Setup-${version}.${ext}` 格式

---

---

## [0.0.5-beta] - 2026-03-14

### 新增

- 关于页面新增应用文件夹、数据文件夹、日志文件夹展示，带一键复制和打开功能

### 修复

- 修复 CI release 正文显示为 commit message 而非 CHANGELOG 内容（/tmp 路径在 Windows runner 上不一致，改用 $RUNNER_TEMP）
- 修复检查更新失败（v0.1.0 404）：删除早期测试遗留的 v0.1.0 tag，该 tag 被 electron-updater 误判为最新版

---

---

## [0.0.4-beta] - 2026-03-14

### 新增

- 设置页新增「关于」页面，显示应用版本号，支持手动检查/下载/安装更新（基于 GitHub Releases）

### 修复

- 修复内置 OpenClaw 在打包版本中升级失败：CI 未捆绑 npm，现已补充（Windows: npm.cmd + node_modules/npm，macOS: lib/node_modules/npm）
- 修复 CI electron-builder 因 publish 配置尝试自动上传导致缺少 GH_TOKEN 报错（改用 `--publish never`）

### 变更

- 所有下拉框替换为 shadcn/ui Select 组件，告别原生样式
- macOS CI 暂时关闭 tag 自动触发，仅保留手动触发（workflow_dispatch）

---

---

## [0.0.3-beta] - 2026-03-14

### 新增

- 应用自动更新：通过 GitHub Releases 自动检测新版本，发现更新后显示 Toast 通知，支持一键下载并重启安装

### 修复

- CI：修复 electron-builder 在 tag push 时因缺少 GH_TOKEN 导致构建失败（加 --publish never，由 softprops 统一上传）

---

## [0.0.2-beta] - 2026-03-14

### 新增

-

### 修复

-

### 变更

-

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
