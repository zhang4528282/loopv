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

### 待办
- [ ] share.loopv.net 内容分享平台
- [ ] 聊天室文件上传测试
- [ ] 域名邮箱配置
