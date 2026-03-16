---
description: 公司版发布助手。将 main 分支合并到 company/toguide 分支并推送到 GitHub。公司分支对图标、名称等有定制（description 为 "TianGong"），合并时保留公司定制内容，不影响主分支。
---

# Company Release Skill

当用户执行 `/release-company` 时，将 main 最新代码合并到公司分支 `company/toguide` 并推送。**每一步都要实际操作，不要只描述。**

---

## Step 1 — 前置检查

并行执行：
1. 用 Bash 运行 `git status` 确认工作区干净（无未提交改动）
2. 用 Bash 运行 `git log --oneline -5` 查看 main 最新提交
3. 用 Bash 运行 `git log origin/company/toguide..main --oneline` 查看 company/toguide 落后 main 多少 commit

**如果工作区有未提交改动**，提示用户先 commit 或 stash，中止操作。

**如果 company/toguide 已包含 main 全部提交**（无差异），告知用户"公司分支已是最新"，结束。

展示待合并的 commit 列表，确认后继续。

---

## Step 2 — 合并 main 到 company/toguide

依次执行：

```bash
git checkout company/toguide
git merge main
```

### 冲突处理策略

公司分支对以下内容有定制，合并冲突时按此规则解决：

| 文件 | 冲突字段 | 保留规则 |
|------|---------|---------|
| `package.json` | `version` | **取 main 的版本号**（最新） |
| `package.json` | `description` | **保留公司的** `"TianGong"` |
| `package.json` | `build.appId` | **保留公司的**（如有差异） |
| `package.json` | `build.productName` | **保留公司的**（如有差异） |
| `app.config.mjs` | 品牌名称、AppID | **保留公司的** |
| `resources/` | 图标、安装器模板 | **保留公司的** |
| 其他文件 | - | **取 main 的**（功能代码以 main 为准） |

如果遇到上述规则未覆盖的冲突，展示冲突内容并询问用户如何解决。

解决冲突后：

```bash
git add <conflicted-files>
git commit -m "merge: 合并 main (v<version>) 到 company/toguide"
```

---

## Step 3 — 推送并切回 main

```bash
git push origin company/toguide
git checkout main
```

推送成功后告知用户合并完成。

---

## 注意事项

- **绝对不要在 company/toguide 分支上修改后反向合并到 main**，公司定制只存在于公司分支
- 合并方向始终是 `main → company/toguide`，单向流动
- 如果 main 还没推送最新 tag，建议用户先执行 `/release` 发布 main，再执行 `/release-company`
- 操作完成后务必切回 main 分支，避免后续开发在错误分支上进行
