# LoopV 项目上下文

> 最后更新: 2026-08-07

## 项目概述

个人域名 `loopv.net` 下的全栈项目集合，基于 GitHub + Cloudflare 全家桶零成本运行。

## 子站点

| 域名 | 用途 | 技术栈 |
|---|---|---|
| **loopv.net** | 个人门户主页 | Astro 5 + Tailwind CSS 4, Cloudflare Pages |
| **chat.loopv.net** | 临时匿名聊天室 | Cloudflare Workers + Durable Objects + D1 + R2 + Hono |
| share.loopv.net | (规划中) 内容分享平台 | — |

## 架构

```
apps/
├── portal/         Astro SSG → Cloudflare Pages 部署
└── chat/
    ├── src/
    │   ├── worker.ts       Hono HTTP 路由 + API
    │   └── chat-room.ts    Durable Object (WebSocket 广播)
    ├── public/             聊天室前端 (原生 HTML/CSS/JS)
    └── migrations/         D1 建表 SQL
```

### 聊天室消息流

```
浏览器 ──WebSocket──> Worker ──获取DO──> ChatRoom DO ──广播──> 所有在线客户端
                           │                    │
                           │                    └── D1 持久化写入
                           │
                           ├── GET  /api/history  → D1 读取历史
                           ├── POST /api/upload   → R2 存储文件
                           └── GET  /media/:name  → R2 读取文件
```

## 关键设计决策

1. **聊天室不用第三方现成方案**：GitHub 上无完全匹配的开源项目（需要 Workers+DO+D1+R2+匿名+多媒体），选择基于 `cloudflare/workers-chat-demo` (1.1k⭐) 的架构自行实现
2. **Hibernation API**：使用 Durable Object 的 WebSocket Hibernation，空闲时不计费，保持长连接
3. **门户融合风格**：极简现代为主体 + 终端元素点缀（打字机效果、模拟终端窗口），而非纯终端风格，兼顾 SEO 和非技术访客
4. **Monorepo**：pnpm workspaces 管理多子站点，共享依赖

## Cloudflare 资源

| 资源 | 名称 | 用途 |
|---|---|---|
| D1 Database | `loopv-chat-db` | 聊天消息持久化 |
| R2 Bucket | `loopv-chat-media` | 聊天室图片/视频/音频存储 |
| Pages 项目 | `loopv-portal` | 门户主页部署 |
| Worker | `loopv-chat` | 聊天室 API + WebSocket |

## 部署流程

1. 在 Cloudflare 控制台创建 D1 (`loopv-chat-db`) 和 R2 (`loopv-chat-media`)
2. 在 D1 Console 执行 `migrations/001_init.sql`
3. 将 D1 database_id 填入 `apps/chat/wrangler.toml`
4. `pnpm --filter @loopv/chat deploy` 部署 Worker
5. Pages 连接 GitHub → 部署 portal（root: `/`, build: `pnpm --filter @loopv/portal build`, output: `apps/portal/dist`）
6. 绑定域名：loopv.net → portal Pages, chat.loopv.net → chat Worker

## 命名约定

- 文件名: kebab-case (`chat-room.ts`, `global.css`)
- 目录: kebab-case
- npm 包: `@loopv/*` scope
- 组件: PascalCase (Astro components)
