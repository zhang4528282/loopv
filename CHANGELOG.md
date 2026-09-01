# 开发日志

## 2026-08-07

### 项目初始化
- 搭建 pnpm monorepo，包含 `apps/portal` (Astro) 和 `apps/chat` (Workers)
- 选择 `cloudflare/workers-chat-demo` 架构 + 自行实现多媒体聊天室

### 门户主页 (loopv.net)
- Astro 5 + Tailwind CSS 4
- 融合风格 → 后改为明亮极简风
- 用户名: WaterMore

### 聊天室 (chat.loopv.net)
- Workers + Durable Objects + D1 + R2 + Hono
- 支持文本/图片/视频/音频/表情包消息
- WebSocket Hibernation API（空闲零计费）

### 部署
- D1: `loopv-chat-db`
- R2: `loopv-chat-media`
- Portal: Cloudflare Pages
- Worker: `loopv-chat`
- 域名: loopv.net → Pages, chat.loopv.net → Worker

### 2026-08-07 (后续)
- **聊天室下线**：chat.loopv.net 停止服务，代码保留在 `apps/chat/`，Worker 已删除
- 门户移除聊天室入口卡片，Terminal 命令更新

## 2026-09-01

### 聊天室重新上线 + 重大重构

#### 认证系统
- 新增用户注册/登录（用户名 + 密码 + 昵称，无邮箱/手机验证）
- 密码 PBKDF2-SHA256 + 随机盐哈希（Web Crypto API）
- Session token 存 D1，7 天过期，登出即销毁
- 第一个注册用户自动成为管理员

#### 用户资料
- 自主修改昵称、上传头像（R2 存储，仅图片）
- 头像可选，无头像时显示昵称首字彩色圆底

#### 消息撤回
- 支持撤回自己的消息，不限时间
- 管理员可撤回任意消息
- WebSocket 实时广播撤回事件

#### 时间显示
- 所有消息统一北京时间（UTC+8）
- 格式：`2026年08月07日 14:30`

#### 管理平台 (admin.loopv.net)
- 统计看板（用户数/消息数/撤回数）
- 用户管理：封禁/解封
- 消息管理：删除消息
- 管理员登录鉴权

#### 数据模型重构
- `users` 表：用户名、密码哈希、盐、昵称、头像、管理员标记、封禁标记
- `sessions` 表：token、用户、过期时间
- `messages` 表：关联 user_id、撤回标记、秒级时间戳

#### 前端
- 聊天室：登录/注册页 + 聊天页（明亮极简风）
- 管理平台：登录页 + 管理看板
- 响应式适配手机，无横向滚动条
