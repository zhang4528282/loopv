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

### 2026-09-01 (后续修复与增强)

#### 修复
- **WebSocket 认证状态丢失**：改用 `serializeAttachment` 存储连接认证状态（替代内存 Map），修复 DO 休眠唤醒后误报「请登录」、账号错乱的问题
- **历史消息重复**：加载历史前先清空列表
- **撤回按钮抖动**：撤回按钮改为常显示，不再 hover 显示（避免布局抖动）

#### 新增
- **在线用户列表**：所有用户可见当前在线成员，桌面端侧边栏 + 移动端抽屉
- 管理员在在线列表中显示「管理员」徽章
- 用户连接/断开实时广播在线状态

### 2026-09-01 (管理平台增强)

#### 消息管理
- 消息状态三态区分：`deleted` 0=正常、1=用户撤回、2=管理员撤回、3=已删除
- **删除**：管理员删除消息（deleted=3），chat 会话界面直接不显示该记录
- **撤回**：管理员撤回消息（deleted=2），chat 界面显示「已被管理员撤回」
- **批量删除**：勾选多条消息一次性删除
- **筛选**：按时间范围、发送者、消息状态筛选
- 管理员操作实时广播，chat 在线用户即时看到撤回/删除

#### 用户管理
- **测试用户角色**：`is_test` 字段，权限与普通用户一致
- 后台创建测试用户（用户名 + 密码 + 昵称），明文密码存 `plain_password` 字段并在后台显示
- 后台删除测试用户
- **筛选**：按用户名、昵称、角色、状态筛选

#### 数据模型
- `users` 表新增 `is_test`、`plain_password` 字段
- `messages.deleted` 字段语义扩展为三态

### 2026-09-01 (门户主页重设计)

#### 设计改造（反 AI 感）
- **配色**：AI 紫渐变（`#6366f1 → #8b5cf6`）→ 低饱和深墨绿单强调色（`#2e5d4f`）+ 暖灰中性底
- **字体**：Inter → Outfit（正文）+ JetBrains Mono（等宽）
- **布局**：居中 hero + 模板三段式 → 非对称 grid 布局
- **终端**：深色终端 → 浅色纸感终端，融入明亮主题
- **动效**：移除无意义循环动画，仅保留一次性 stagger 入场 + 打字机叙事 + hover 反馈，尊重 `prefers-reduced-motion`

#### 新增
- **聊天室入口**：`ChatCta.astro` 墨绿大卡片「进来聊聊」，作为页面视觉焦点
- **导航栏**：`Header.astro` 简洁导航

#### 组件变化
- 新增 `Header.astro`、`ChatCta.astro`
- 重写 `Hero.astro`、`Terminal.astro`、`About.astro`、`Footer.astro`

### 2026-09-01 (聊天室界面调整)

#### 移除角色 tag
- 在线用户列表移除「管理员」徽章，不显示任何角色 tag
- 保留「（我）」标记

#### 时区显示功能
- 消息时间按用户设置的时区显示，默认东八区（Asia/Shanghai 北京时间）
- 设置弹窗新增「时区」下拉选择（19 个常用时区，中文名 + 动态 UTC 偏移）
- 时区设置持久化到 localStorage，保存后即时刷新已显示消息时间

### 2026-09-01 (安全加固)

#### 修复的漏洞
- **任意文件上传 → 存储型 XSS**：`/api/upload` 增加危险 MIME 黑名单（`text/html`、`image/svg+xml`、`application/octet-stream` 等）+ 危险扩展名黑名单（`.html`、`.svg`、`.js`、`.xml` 等）双重拦截；头像上传拒绝 SVG；`/media/*` 响应加 `X-Content-Type-Options: nosniff`
- **登录/注册暴力破解**：新增 `RateLimiter` Durable Object，按 IP 限流（10 分钟 5 次失败锁定 15 分钟），登录/注册成功自动清零；锁定期间窗口过期不会绕过（固定保留 lockedUntil）
- **WebSocket 刷屏**：消息发送 800ms 节流、撤回 300ms 节流；消息内容限 5000 字符
- **media_url 协议注入**：后端 WS 仅允许 `/media/` 前缀（拒绝 `javascript:` 等协议），INSERT 与广播均使用过滤后的值；前端 file 链接 href 加白名单双保险
- **CORS 全开**：origin 白名单收窄为 `chat.loopv.net` / `admin.loopv.net` / `localhost` / `127.0.0.1`

#### 额外加固
- **管理平台**：admin API 仅允许通过 `admin.loopv.net` 域名访问（本地开发 localhost 放行），通过 chat 域名访问管理接口返回 403

### 2026-09-01 (昵称/头像同步修复)

#### 修复
- **历史消息资料不同步**：修改昵称/头像后，同步 `UPDATE messages` 表中该用户的历史消息快照（nickname / avatar_url），历史消息即时显示最新资料
- **在线连接资料缓存**：修改资料后通过内部 `/profile-update` 通知 DO，刷新该用户所有在线 WebSocket 连接的 `serializeAttachment`，新消息与在线列表即时显示最新昵称/头像，无需重新连接
