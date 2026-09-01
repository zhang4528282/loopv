# AGENTS.md

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
```

## 部署

| 项目 | 部署方式 |
|---|---|
| **loopv.net** (门户) | Cloudflare Pages 连接 GitHub，推送 master 自动部署。构建命令 `pnpm --filter @loopv/portal build`，输出 `apps/portal/dist` |
| **chat.loopv.net** (聊天室) | 在 `apps/chat/` 下手动执行 `npx wrangler deploy`。根目录 `pnpm deploy:chat` 无效——这是 pnpm 自身的 deploy 命令，不是 wrangler 的 |

## 架构要点

- **Monorepo**：pnpm workspaces，`apps/portal` 和 `apps/chat` 独立无共享代码
- **聊天室前端**：`apps/chat/public/` 下分 `chat/`（聊天室）和 `admin/`（管理平台）两个目录，纯 HTML/CSS/JS，由 Worker 的 `[assets]` 配置作为静态资源一并上传，不是独立部署
- **聊天室后端**：Hono 路由 (`worker.ts`) + Durable Object (`chat-room.ts` WebSocket 广播/认证 + `rate-limiter.ts` 按 IP 登录限流)。DO 使用 Hibernation API（`acceptWebSocket`）空闲不计费
- **chat + admin 共用一个 Worker**：通过 `host` header 区分（`admin.` 前缀），静态资源映射 `/chat/*` 和 `/admin/*`；admin API 仅允许 admin 域名访问（本地 localhost 放行）
- **DO 认证状态**：用 `serializeAttachment` 存储每连接用户信息（Hibernation 下内存 Map 会失效，勿用）
- **安全约束**：上传校验用 `DANGEROUS_TYPES` / `DANGEROUS_EXTS` 黑名单（worker.ts 顶部）；WS 消息 content 限 5000 字符、发送 800ms 节流、`media_url` 仅接受 `/media/` 前缀；CORS 白名单为 chat/admin.loopv.net + localhost
- **D1 迁移**：不会自动执行。CI 中或首次部署前需手动跑 `wrangler d1 execute loopv-chat-db --file=./migrations/001_init.sql`

## 数据模型关键约束

- **消息 `deleted` 四态**：`0`=正常、`1`=用户撤回（chat 显示「消息已撤回」）、`2`=管理员撤回（chat 显示「已被管理员撤回」）、`3`=已删除（chat 不显示）。改逻辑时勿混淆
- **用户角色**：`is_admin`（管理员）+ `is_test`（测试用户，权限同普通用户，`plain_password` 存明文密码）+ `banned`（封禁）。第一个注册用户自动成为管理员

## 关键约束

- **DO free plan**：`wrangler.toml` 中 migration 必须用 `new_sqlite_classes`（不是 `new_classes`），否则部署报错 10097
- **Tailwind v4**：通过 `@tailwindcss/vite` 插件加载，CSS 入口是 `@import "tailwindcss"`，不是传统 PostCSS 配置
- **无测试**：没有 vitest/jest 配置。验证手段只有 `pnpm build`（编译检查）和浏览器手动测试
- **pnpm only**：`package.json` 通过 `onlyBuiltDependencies` 声明了必须构建的原生包（esbuild, sharp, workerd）
