# LoopV

> WaterMore 的个人项目集合，基于 GitHub + Cloudflare 全家桶零成本运行。

## 站点

| 域名 | 用途 | 技术栈 |
|---|---|---|
| **[loopv.net](https://loopv.net)** | 个人门户主页 | Astro 5 + Tailwind CSS 4, Cloudflare Pages |
| **[chat.loopv.net](https://chat.loopv.net)** | 匿名聊天室（注册登录） | Cloudflare Workers + Durable Objects + D1 + R2 + Hono |
| **[admin.loopv.net](https://admin.loopv.net)** | 聊天室管理平台 | 同 chat Worker，host 路由区分 |
| **[docs.loopv.net](https://docs.loopv.net)** | 项目文档站（登记于 docs.ts SOURCES 的仓库 md） | Astro 5 + Tailwind CSS 4 + markdown-it, Cloudflare Pages |

## 项目结构

```
apps/
├── portal/          # loopv.net 门户主页
│   └── src/
│       ├── components/   # Astro 组件
│       ├── layouts/      # 页面布局
│       ├── pages/        # 路由页面
│       └── styles/       # 全局样式
├── docs/            # docs.loopv.net 项目文档站
│   └── src/
│       ├── components/   # Astro 组件
│       ├── layouts/      # 页面布局
│       ├── pages/        # 路由页面（含 /manifest.json）
│       └── lib/docs.ts   # 文档收录清单 SOURCES + 渲染管线
└── chat/            # chat.loopv.net + admin.loopv.net
    ├── src/
    │   ├── worker.ts       # Worker 入口 + Hono 路由
    │   ├── chat-room.ts    # Durable Object (WebSocket 广播 + 认证)
    │   ├── rate-limiter.ts # Durable Object (按 IP 登录/注册限流)
    │   └── auth.ts         # 密码哈希 + session 工具
    ├── public/
    │   ├── chat/           # 聊天室前端
    │   └── admin/          # 管理平台前端
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

## 功能特性

- **认证系统**：用户名 + 密码 + 昵称注册登录（无邮箱/手机验证），PBKDF2 密码哈希 + session；注册密码二次确认 + 明文/密文切换
- **用户资料**：自主修改昵称、上传头像（可选）
- **消息撤回**：不限时撤回自己的消息（长按/常显撤回箭头 + 二次确认），管理员可撤回任意消息
- **在线用户列表**：实时显示在线成员，上下线即时同步
- **上下线通知**：用户上下线小提示（毛玻璃胶囊 + 状态点）+ 提示音效，可在设置中开关（默认关闭）
- **新消息音效**：他人发消息时的清脆提示音，设置中开关（默认关闭）
- **消息同步兜底**：WS 断线重连后自动补齐历史消息 + 顶栏手动刷新按钮（同时刷新在线成员）
- **管理平台**：统计看板、用户管理（封禁/测试用户）、消息管理（撤回/删除/批量/筛选）
- **时间显示**：默认北京时间（UTC+8），可切换 19 个常用时区
- **安全加固**：上传 MIME/扩展名双重黑名单、按 IP 登录限流、WS 消息节流、CORS 白名单、admin 域名隔离

> 📖 详细使用说明见 [chat 操作手册](docs/chat-manual.md) · 隐私与数据处理见 [隐私政策](docs/privacy-policy.md) · 隐私安全自审见 [安全自审报告](docs/security-review.md)

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
3. 将 D1 database_id 填入 `apps/chat/wrangler.toml`（DO/D1/R2 绑定已声明）
4. 部署聊天室：`cd apps/chat && wrangler deploy`
5. Pages 连接 GitHub 部署门户（构建命令 `pnpm --filter @loopv/portal build`，输出 `apps/portal/dist`）
6. 绑定自定义域名

## 许可证

MIT
