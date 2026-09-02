# LoopV 项目上下文

> 最后更新: 2026-09-02

## 项目概述

个人域名 `loopv.net` 下的全栈项目集合，基于 GitHub + Cloudflare 全家桶零成本运行。

## 子站点

| 域名 | 用途 | 技术栈 |
|---|---|---|
| **loopv.net** | 个人门户主页 | Astro 5 + Tailwind CSS 4, Cloudflare Pages |
| **chat.loopv.net** | 匿名聊天室（注册登录） | Cloudflare Workers + Durable Objects + D1 + R2 + Hono |
| **admin.loopv.net** | 聊天室管理平台 | 同 chat Worker，host 路由区分 |
| share.loopv.net | (规划中) 内容分享平台 | — |

## 架构

```
apps/
├── portal/         Astro SSG → Cloudflare Pages 部署
└── chat/
    ├── src/
    │   ├── worker.ts       Hono HTTP 路由 + API（含 chat + admin 两套）
    │   ├── chat-room.ts    Durable Object (WebSocket 广播 + 认证)
    │   ├── rate-limiter.ts Durable Object (按 IP 登录/注册限流，防暴力破解)
    │   └── auth.ts         密码哈希 + session 工具
    ├── public/
    │   ├── chat/           聊天室前端 (原生 HTML/CSS/JS)
    │   └── admin/          管理平台前端
    └── migrations/         D1 建表 SQL
```

### 聊天室消息流

```
浏览器 ──WebSocket──> Worker ──获取DO──> ChatRoom DO ──广播──> 所有在线客户端
                           │                    │
                           │                    └── D1 持久化写入
                           │
                           ├── GET  /api/history     → D1 读取历史（过滤已删除）
                           ├── POST /api/upload      → R2 存储文件
                           ├── GET  /media/:name     → R2 读取文件
                           └── admin API（撤回/删除）→ D1 + DO 广播实时推送
```

## 数据模型

### users 表
| 字段 | 说明 |
|---|---|
| `username` / `password_hash` / `salt` | 用户名 + PBKDF2-SHA256 哈希密码 + 随机盐 |
| `nickname` / `avatar_url` | 昵称 / 头像（R2，可选） |
| `is_admin` | 管理员标记（第一个注册用户自动成为管理员） |
| `is_test` | 测试用户标记（权限同普通用户，后台可看明文密码） |
| `plain_password` | 测试用户明文密码（仅 is_test=1 有值） |
| `banned` | 封禁标记 |

### sessions 表
- `token` / `user_id` / `expires_at`：session token，7 天过期

### messages 表
- `deleted` 字段四态语义：
  - `0` = 正常
  - `1` = 用户撤回（chat 显示「消息已撤回」）
  - `2` = 管理员撤回（chat 显示「已被管理员撤回」）
  - `3` = 已删除（chat 完全不显示）

## 关键设计决策

1. **聊天室不用第三方现成方案**：GitHub 上无完全匹配的开源项目（需要 Workers+DO+D1+R2+匿名+多媒体），选择基于 `cloudflare/workers-chat-demo` (1.1k⭐) 的架构自行实现
2. **Hibernation API**：使用 Durable Object 的 WebSocket Hibernation，空闲时不计费，保持长连接
3. **认证状态用 serializeAttachment**：DO 休眠唤醒后内存 Map 会失效，用 `serializeAttachment` 存储每连接的认证状态（Cloudflare 官方方案）
4. **chat + admin 共用一个 Worker**：通过 `host` header 区分（`admin.` 前缀），复用 D1/R2 绑定
5. **门户反 AI 感设计**：低饱和深墨绿单强调色（`#2e5d4f`）+ 暖灰中性底，Outfit 字体 + 非对称布局，浅色纸感终端，刻意避免 AI 紫渐变、模板化三段式等 AI 生成痕迹
6. **Monorepo**：pnpm workspaces 管理多子站点，共享依赖
7. **按 IP 限流用 Durable Object**：登录/注册暴力破解防护用独立 `RateLimiter` DO（DO storage 持久化），不用 D1 建表——避免手动 SQL migration，DO 的 `new_sqlite_classes` migration 随 wrangler deploy 自动生效
8. **上传安全策略**：R2 上传走 MIME + 扩展名双重黑名单，危险类型（html/svg/js/xml 等）直接拒绝；媒体响应加 `nosniff`；WebSocket 消息的 `media_url` 仅接受 `/media/` 前缀

## Cloudflare 资源

| 资源 | 名称 | 用途 |
|---|---|---|
| D1 Database | `loopv-chat-db` | 用户/会话/消息持久化 |
| R2 Bucket | `loopv-chat-media` | 聊天室图片/视频/音频/头像存储 |
| Pages 项目 | `loopv-portal` | 门户主页部署 |
| Worker | `loopv-chat` | 聊天室 + 管理平台 API + WebSocket |

## 部署流程

1. 在 Cloudflare 控制台创建 D1 (`loopv-chat-db`) 和 R2 (`loopv-chat-media`)
2. 在 D1 Console 执行 `migrations/001_init.sql`
3. 将 D1 database_id 填入 `apps/chat/wrangler.toml`
4. `cd apps/chat && npx wrangler deploy` 部署 Worker
5. Pages 连接 GitHub → 部署 portal（root: `/`, build: `pnpm --filter @loopv/portal build`, output: `apps/portal/dist`）
6. 绑定域名：loopv.net → Pages；chat.loopv.net / admin.loopv.net → Worker（DNS CNAME 到 workers.dev）

## 命名约定

- 文件名: kebab-case (`chat-room.ts`, `global.css`)
- 目录: kebab-case
- npm 包: `@loopv/*` scope
- 组件: PascalCase (Astro components)
