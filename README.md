# LoopV

> WaterMore 的个人项目集合，基于 GitHub + Cloudflare 全家桶零成本运行。

## 站点

| 域名 | 用途 | 技术栈 |
|---|---|---|
| **[loopv.net](https://loopv.net)** | 个人门户主页 | Astro 5 + Tailwind CSS 4, Cloudflare Pages |
| **[chat.loopv.net](https://chat.loopv.net)** | 临时匿名聊天室 | Cloudflare Workers + Durable Objects + D1 + R2 + Hono |

## 项目结构

```
apps/
├── portal/          # loopv.net 门户主页
│   └── src/
│       ├── components/   # Astro 组件
│       ├── layouts/      # 页面布局
│       ├── pages/        # 路由页面
│       └── styles/       # 全局样式
└── chat/            # chat.loopv.net 聊天室
    ├── src/
    │   ├── worker.ts       # Worker 入口 + Hono 路由
    │   └── chat-room.ts    # Durable Object (WebSocket 广播)
    ├── public/             # 前端静态文件
    └── migrations/         # D1 数据库初始化 SQL
```

## 聊天室架构

```
浏览器 ──WebSocket──> Worker ──Durable Object──> 广播给所有在线客户端
                           │
                           ├── GET  /api/history  → D1 读取历史消息
                           ├── POST /api/upload   → R2 存储媒体文件
                           └── GET  /media/:name  → R2 读取文件
```

- **实时通信**：Durable Objects + WebSocket Hibernation API（空闲不计费）
- **消息持久化**：D1（边缘 SQLite）
- **媒体存储**：R2（免出站流量费）
- 消息类型支持：文本、图片、视频、音频、表情包

## 快速开始

### 前置要求

- Node.js 22+ / pnpm
- Cloudflare 账号
- 已购买域名并托管 DNS 到 Cloudflare

### 本地开发

```bash
# 安装依赖
pnpm install

# 启动门户主页（localhost:4321）
pnpm --filter @loopv/portal dev

# 启动聊天室（本地 Worker）
pnpm --filter @loopv/chat dev
```

### 部署

1. 在 Cloudflare 控制台创建 D1 数据库 (`loopv-chat-db`) 和 R2 存储桶 (`loopv-chat-media`)
2. 在 D1 Console 执行 `apps/chat/migrations/001_init.sql`
3. 复制 `apps/chat/wrangler.toml.example` 为 `wrangler.toml`，填入 D1 database_id
4. 部署聊天室：`cd apps/chat && wrangler deploy`
5. Pages 连接 GitHub 部署门户（构建命令 `pnpm --filter @loopv/portal build`，输出 `apps/portal/dist`）
6. 绑定自定义域名

## 许可证

MIT
