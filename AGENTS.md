# AGENTS.md

## 工作流约定（重要）

- **每次代码修改完成后，无需用户授权，自动执行：涉及 chat 代码的改动先 `pnpm --filter @loopv/chat build` 验证 → 更新 CHANGELOG.md（开发日志，按北京时间记录）→ git commit → git push → 线上验证。chat 的部署由 GitHub Actions（`.github/workflows/deploy-chat.yml`）在推送后自动完成，**不需要也不应该**本地再手动 `wrangler deploy`（会与 CI 重复）**
- 提交信息用 conventional commits 风格（feat/fix/chore/docs + 英文简述）
- 部署前先 `pnpm --filter @loopv/chat build` 确认编译通过

## 项目命令

```bash
# 安装
pnpm install

# 门户主页 (localhost:4321)
pnpm --filter @loopv/portal dev

# 聊天室本地
pnpm --filter @loopv/chat dev

# 聊天室编译验证（不部署）
pnpm --filter @loopv/chat build

# 文档站本地 (docs.loopv.net)
pnpm --filter @loopv/docs dev

# 文档站编译验证（不部署）
pnpm --filter @loopv/docs build
```

## 部署

| 项目 | 部署方式 |
|---|---|
| **loopv.net** (门户) | Cloudflare Pages 连接 GitHub，推送 master 自动部署。构建命令 `pnpm --filter @loopv/portal build`，输出 `apps/portal/dist` |
| **chat.loopv.net** (聊天室) | GitHub Actions（`.github/workflows/deploy-chat.yml`）：推送 master 且改动 `apps/chat/**` / `pnpm-lock.yaml` / workflow 时自动 `pnpm --filter @loopv/chat build` + `wrangler deploy`（workingDirectory = `./apps/chat`）。先决条件：仓库 Actions secrets 已配置 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；DO `new_sqlite_classes` migration 随部署自动生效，但 D1 表结构迁移（`migrations/*.sql`）仍需手动执行 |
| **docs.loopv.net** (文档站) | Cloudflare Pages 连接 GitHub，推送 master 自动部署。构建命令 `pnpm --filter @loopv/docs build`，输出 `apps/docs/dist`。内容 = `apps/docs/src/lib/docs.ts` 的 `SOURCES` 清单中登记的文件（仓库根目录 `*.md` + `docs/*.md`）；**新增文档必须在此文件登记**，否则不进文档站 |

## 架构要点

- **Monorepo**：pnpm workspaces，`apps/portal`、`apps/docs`、`apps/chat` 独立无共享代码
- **docs 文档站**：`apps/docs` 构建时按 `apps/docs/src/lib/docs.ts` 的 `SOURCES` 硬编码清单读取对应 md（gray-matter + markdown-it 渲染成静态页），推送 master 自动重建；**新增 md 必须同步登记到 `SOURCES`（含 repoPath/slug/group），不会自动收录**；修改已收录 md 推送即生效
- **聊天室前端**：`apps/chat/public/` 下分 `chat/`（聊天室）和 `admin/`（管理平台）两个目录，纯 HTML/CSS/JS，由 Worker 的 `[assets]` 配置作为静态资源一并上传，不是独立部署
- **聊天室后端**：Hono 路由 (`worker.ts`) + Durable Object (`chat-room.ts` WebSocket 广播/认证 + `rate-limiter.ts` 按 IP 登录限流)。DO 使用 Hibernation API（`acceptWebSocket`）空闲不计费
- **chat + admin 共用一个 Worker**：通过 `host` header 区分（`admin.` 前缀），静态资源映射 `/chat/*` 和 `/admin/*`；admin API 仅允许 admin 域名访问（本地 localhost 放行）
- **DO 认证状态**：用 `serializeAttachment` 存储每连接用户信息（Hibernation 下内存 Map 会失效，勿用）
- **安全约束**：上传校验用 `DANGEROUS_TYPES` / `DANGEROUS_EXTS` 黑名单（worker.ts 顶部）；WS 消息 content 限 5000 字符、发送 800ms 节流、`media_url` 仅接受 `/media/` 前缀；CORS 白名单为 chat/admin.loopv.net + localhost
- **D1 迁移**：不会自动执行。CI 中或首次部署前需手动跑 `wrangler d1 execute loopv-chat-db --file=./migrations/001_init.sql` 与 `--file=./migrations/002_invite_settings.sql`（002 建 `settings` 表，承载邀请码 / docs_hidden / deleted_usernames）

## 数据模型关键约束

- **消息 `deleted` 四态**：`0`=正常、`1`=用户撤回（chat 显示「消息已撤回」）、`2`=管理员撤回（chat 显示「已被管理员撤回」）、`3`=已删除（chat 不显示）。改逻辑时勿混淆
- **用户角色**：`is_admin`（管理员）+ `is_test`（测试用户，权限同普通用户，明文密码仅创建时一次性回显、列表不返回）+ `banned`（封禁）。第一个注册用户自动成为管理员
- **settings 表键**：`invite_code_enabled`/`invite_code`（注册邀请码）、`docs_hidden`（docs 站隐藏 slug）、`deleted_usernames`（用户名 tombstone，同名禁止重注册）
- **账号与隐私约束（防回归）**：注册需 `agreement: true`（隐私政策同意）；密码 8-64；`/api/history` 需登录且对撤回消息（deleted 1/2）返回时脱敏；封禁/删除用户/自助注销/改密会经 DO `/kick` 断开其全部在线连接

## 关键约束

- **DO free plan**：`wrangler.toml` 中 migration 必须用 `new_sqlite_classes`（不是 `new_classes`），否则部署报错 10097
- **Tailwind v4**：通过 `@tailwindcss/vite` 插件加载，CSS 入口是 `@import "tailwindcss"`，不是传统 PostCSS 配置
- **无测试**：没有 vitest/jest 配置。验证手段只有 `pnpm build`（编译检查）和浏览器手动测试
- **pnpm only**：`package.json` 通过 `onlyBuiltDependencies` 声明了必须构建的原生包（esbuild, sharp, workerd）
