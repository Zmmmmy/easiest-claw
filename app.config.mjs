/**
 * app.config.mjs — 品牌与应用身份配置（单一维护入口）
 *
 * Fork 后只需修改这里，然后运行 `pnpm run brand` 即可同步所有相关文件。
 * 图标文件另行替换 resources/icon.png / icon.ico / icon.icns 后重新构建即可。
 *
 * 运行后会更新：
 *   src/shared/branding.ts    — TypeScript 常量（main + renderer 使用）
 *   resources/installer.nsh  — Windows NSIS 安装脚本
 *   package.json              — description / build.appId / build.productName
 */

export default {
  // ── 应用身份 ────────────────────────────────────────────────────────────────
  appName:         '天工AI',                          // UI 显示名称
  appId:           'cn.toguide.tiangong',             // 反向域名，需全局唯一
  productName:     'TianGong',                        // 安装包 / Dock 名称
  description:     'TianGong',

  // ── Windows 防火墙 ───────────────────────────────────────────────────────────
  firewallRuleName: 'TianGong',                       // Windows Defender 规则名称
}
