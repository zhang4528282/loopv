# 开发日志

## 2026-09-04

### GitHub Actions 自动部署 loopv-chat（替代手动 wrangler deploy）
#### 新增
- **`deploy-chat.yml` workflow**：推送 master 且改动 `apps/chat/**` / `pnpm-lock.yaml` / 本 workflow 时自动执行 `pnpm install --frozen-lockfile` → `pnpm --filter @loopv/chat build`（编译验证）→ `cloudflare/wrangler-action@v4` 部署到 Cloudflare Workers（workingDirectory = `./apps/chat`，DO `new_sqlite_classes` migration 随 deploy 自动生效）
- 至此 loopv-chat 与 loopv / loopv-docs 均通过 GitHub 推送 master 自动部署；chat 不再需要本地手动 `wrangler deploy`
- 先决条件：仓库 Actions secrets 需配置 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`（未配置时 workflow 部署步骤会失败，Worker 维持线上旧版本不受影响）；D1 表结构迁移（`migrations/*.sql`）依旧需要手动执行，不随自动部署运行

### 文档站 docs.loopv.net
#### 新增
- **docs.loopv.net 静态文档站**：新增 `apps/docs`（Astro 5 + Tailwind CSS 4，设计语言与门户一致：暖灰纸底 + 墨绿单强调色）。收录仓库全部 Markdown——根目录 `README.md`/`CONTEXT.md`/`CHANGELOG.md`/`AGENTS.md`（「项目文档」组）+ `docs/chat-manual.md`（「操作手册」组）
- **构建时内容管线**：`src/lib/docs.ts` 用 fs 读取源 md（gray-matter 解析 + markdown-it 渲染 + markdown-it-anchor 中文锚点），URL：`/` 目录页 + `/readme` `/context` `/changelog` `/agents` `/chat-manual`；单篇页含源文件路径 mono 标注、右侧吸顶目录（客户端扫 h2/h3 生成 + IntersectionObserver 滚动高亮，无 JS 优雅降级不渲染）；README 相对链接映射到站内
- **门户入口**：loopv.net 新增「03 — 文档」浅色纸卡区块（标题 + 说明 + docs.loopv.net 链接 + 常用文档直达行），顶栏导航与页脚新增「文档」链接
#### 部署
- docs.loopv.net → Cloudflare Pages 新项目 `loopv-docs`（构建 `pnpm --filter @loopv/docs build`，输出 `apps/docs/dist`，推送 master 自动部署），需在控制台创建 Pages 项目并绑定域名

### 文档显示开关（admin 后台控制 docs 文章是否显示）
#### 新增
- **后台控制文档显隐**：admin.loopv.net 新增「文档管理」区块——列出 docs.loopv.net 全部文档（标题/分组/slug + 复用现有渐变 switch），开关控制每篇显示/隐藏，底部「保存更改」批量提交
- **后端接口**（worker.ts）：公开 `GET /api/docs/visibility`（无需登录，返回 `{ hidden: [...] }`，docs 构建期拉取）；管理 `PUT /api/admin/docs`（adminMiddleware，slug 白名单 `^[a-z0-9-]+$`、去重、上限 100，写入 settings 表 `docs_hidden`，触发 Pages Deploy Hook 重建）
- **docs 构建联动**：构建时拉取可见性接口，被隐藏文档不生成页面（直链 404）、不进目录、分组计数与总篇数跟随可见集合；`/manifest.json` 静态端点输出全部文档（含隐藏项，hidden 标记）供 admin 跨域读取，`public/_headers` 放行 CORS；失败降级为全部显示，绝不影响构建
- **README 相对链接联动**：指向被隐藏文档的站内链接自动还原为纯文本，不落 404
- 注：重建需 Deploy Hook（env secret `DOCS_DEPLOY_HOOK`），未配置时保存仍生效但需手动推送触发重建
#### 部署
- chat Worker 新增两组接口 + admin 前端静态资源 → `cd apps/chat && npx wrangler deploy`

### 隐私安全自审与隐私政策文档
#### 新增
- **《LoopV 隐私政策》**（`docs/privacy-policy.md`，进 docs 站「隐私政策」组）：面向用户的合规文档——收集项（账号/消息/媒体/技术信息，明确列出**不收集**项与无广告无追踪）、存储与保护（Cloudflare 境外基础设施、PBKDF2、HTTPS、上传黑名单）、共享披露（仅基础设施 + Google Fonts）、撤回/删除的**可见性语义如实表述**（撤回不可回收已送达内容）、保存期限表、用户权利、未成年人、联系方式。注册流程接入同意勾选列为待办（见自审报告 P1）
- **《LoopV 隐私安全自审报告》**（`docs/security-review.md`，进 docs 站「项目文档」组）：代码级静态自审（chat/admin Worker + DO + 前端 + 静态站），逐条核实 11 项既有安全控制，输出 F1-F13 发现 + 2 项附带产品缺口 + PIPL 合规对照 + P0/P1/P2 整改清单
#### 自审关键发现（已核实，本次仅评估不修复）
- **F1 高危**：`GET /api/history` 无强制登录且对 `deleted=1/2`（撤回）消息仍返回 `content/media_url` 原文——撤回仅是「视觉撤回」，匿名可翻页拉取全量历史与媒体 URL
- **F2 高危**：封禁/删除用户仅清 HTTP session，不中断已建立的 WebSocket（DO 无 kick 广播），被封禁者可继续发消息直至断连
- **F3/F4**：无用户自助注销；消息删除为软删（deleted=3）+ R2 对象无删除接口、孤儿对象累积（媒体 `immutable` 缓存 1 年，物理删除需同步 purge）
- **F5-F13**：admin 用户列表多余返回 `plain_password` 列、过期 session/限流键无清理、localStorage 凭证 + 无 CSP、缺基础安全头、用户名枚举（注册 409 + 封禁 403 与登录 401 文案差异）、媒体文件名可推测、自增 userId 暴露、Google Fonts 第三方请求
- 附带：无改密接口、删除用户后 username 可被重新注册致历史归属混淆、密码下限 6、非法 JSON 返回 500
#### 文档同步
- **docs.ts SOURCES 登记**新文档两篇（privacy-policy 入「隐私政策」组、security-review 入「项目文档」组）
- **AGENTS.md / CONTEXT.md 校正收录规则**：此前描述为「新增 md 自动收录」，实际 docs.ts `SOURCES` 为硬编码清单、新增必须手动登记——两文件同步修正；CONTEXT 数据模型补 `settings` 表
- **README.md** 站点表补 docs.loopv.net、文档链接区补隐私政策与自审报告入口；**chat-manual.md** 注意事项补隐私政策指引

### 隐私安全整改实施（P0/P1/P2 + G1-G4）
#### 修复
- **F1 高危（撤回=视觉撤回）**：`/api/history` 强制登录 + 对 `deleted=1/2` 撤回消息返回时清空 `content/media_url/media_type`，匿名翻页拉取撤回原文/媒体 URL 的通道封死
- **F2 高危（封禁不中断 WS）**：新增 DO 内部 `/kick` 端点，封禁/删除用户/自助注销/改密后断开其全部 WebSocket；chat 前端收到 `kick` 事件清 session 回登录页（不自动重连）
- **F3 自助注销**：新增 `POST /api/auth/delete-account`（密码校验、管理员 403、级联清理消息/会话/账号 + R2 媒体），chat 设置「账号安全」区块提供注销入口（二次确认 + 密码）
- **F4 R2 级联清理**：删除消息/批量删除/更换头像/自助注销时物理删除对应 R2 对象
- **F5 最小化**：admin 用户列表 SQL 与前端表格移除 `plain_password` 列（测试用户明文仅创建时一次性回显）
- **F6 过期 session**：登录/注册成功顺带清理过期 session 行
- **P1 合规**：注册接口要求 `agreement: true`，chat 注册表单新增隐私政策链接 + 同意勾选
- **F8 安全头**：全站基础安全头（nosniff/X-Frame-Options/Referrer-Policy）+ HTML CSP（chat/admin 静态页经 serveAsset 兜底包装确保生效；CSP 同步移除 Google Fonts 白名单）
- **F9 枚举收敛**：封禁账号登录不再返回 403「账号已被封禁」，与不存在/密码错误统一 401 文案
- **F10 RateLimiter 残留键**：DO 增加每日 Alarm 清理过期限流键
- **F11 文件名可推测**：头像/媒体文件改 32 位加密随机名，不再含 userId/时间戳
- **F13 字体 self-host**：portal/docs 改用 @fontsource 本地打包；chat/admin 静态字体复制至 `public/{chat,admin}/fonts/` + @font-face，全部移除 fonts.googleapis/gstatic 外链
- **G1/G3 账号能力**：新增改密接口（旧密码校验、8-64、改后全会话失效 + 踢下线）；密码下限 6→8（注册/改密/admin 创建测试用户 + 前端 placeholder）
- **G2 username tombstone**：注销/删除用户记录 username 至 settings `deleted_usernames`，同名禁止重新注册（防历史归属混淆）
- **G4 非法 JSON**：`safeJson` 工具包裹全部 JSON 请求体解析，非法输入统一返回 400 而非 500
#### 新增（前端 UI）
- chat 设置弹窗新增「账号安全」区块：修改密码、注销账号（管理员隐藏注销入口并提示不支持）
- chat 注册表单新增《隐私政策》链接与同意勾选（仅注册模式显示）
- 注销账号确认弹窗（危险说明 + 密码确认，回车可提交）
#### 文档同步
- `docs/security-review.md` 追加「整改记录」表（全部 F/G 项已修复）
- `docs/privacy-policy.md` 同步已上线能力（注册同意已接入、自助注销、修改密码、媒体级联删除、tombstone 说明、字体自托管）
- `docs/chat-manual.md` 更新（密码 8-64、隐私勾选、账号安全区块、封禁即断连、删除用户后用户名不可再注册、测试密码仅创建时展示）

## 2026-09-02

### 注册/登录表单增强

#### 新增
- **密码二次确认**：注册模式下新增「确认密码」输入框（登录模式隐藏），提交时校验两次密码一致，不一致提示「两次输入的密码不一致」；切换登录/注册时自动清空确认密码框
- **密码可见性切换**：登录/注册密码框和确认密码框右侧增加眼睛按钮，点击切换明文/密文，图标随状态睁眼/闭眼，带 aria-label/aria-pressed 无障碍支持

### 在线状态下线同步修复
#### 修复
- **下线状态不同步（根因修复）**：`webSocketClose` 触发时刚关闭的 socket 仍处于 CLOSING 状态，`ctx.getWebSockets()` 仍返回它（官方文档确认），`getOnlineUsers()` 会把它计入在线列表并广播出去，之后无事件再触发重算，陈旧列表在其他客户端永久残留。`ws.close()` 只修复了 socket 生命周期（连接不再卡在 CLOSING），未修复广播内容竞态
- **修复方案**：`getOnlineUsers(exclude?)` / `broadcastOnlineUsers(exclude?)` 支持排除参数，`webSocketClose` 广播时传入正在关闭的 `ws` 排除自身，确保离线用户被立即移除；多标签页场景只排除关闭的连接，另一连接保持在线，不受影响
- **补充**：compat date < 2026-04-07 时 `webSocketClose` 仍需手动 `ws.close(code, reason)` 完成关闭握手（`web_socket_auto_reply_to_close` 默认未启用）

### 上下线通知功能
#### 新增
- **上下线小提示**：有用户上线/下线时，会话界面消息区顶部居中弹出胶囊提示「xxx 上线了/下线了」，3.5 秒后自动淡出消失，多条提示可堆叠，尊重 `prefers-reduced-motion`；自己的上下线事件自动过滤
- **提示音效**：Web Audio API 生成短音（无需音频文件），上线升调（660→880Hz）、下线降调（880→660Hz），带防爆音包络、复用单个 AudioContext
- **设置开关**：设置弹窗新增「上下线提醒」「提示音效」两个 switch 开关，**默认关闭**，持久化到 localStorage
- **后端事件广播**：`handleAuth` 仅当用户首次上线（无其他在线连接）广播 `user_online`，`webSocketClose` 仅当用户完全下线（排除自身后无剩余连接）广播 `user_offline`，多标签页不重复广播

### 保存设置触发假上下线提醒修复
#### 修复
- **保存设置后其他用户看到多余的「下线了→上线了」提醒**：`saveSettings()` 保存后无条件调用 `reconnectForProfile()` 重连 WS，触发 `webSocketClose` 广播 `user_offline`、重连后 `handleAuth` 又广播 `user_online`。已移除该重连调用（及其函数）——重连初衷是刷新 DO 缓存，现已被 `/profile-update` 内部通知 + 前端 `refreshMessagesOfUser` 完全覆盖，无需重连

### 上下线提示条视觉优化
#### 优化
- **毛玻璃效果**：提示条背景改为半透明 + `backdrop-filter: blur(10px)`（含 `-webkit-` 前缀），质感更柔和，`prefers-reduced-motion` 不受影响
- **状态点**：提示条文本前新增圆形状态点——上线绿色（#22c55e）、下线灰色（#9ca3af），带白描边保证毛玻璃上清晰可见；JS 用文本节点生成昵称文本（避免 innerHTML 拼接用户输入）

### 消息同步兜底（重连自动补齐 + 手动刷新）
#### 新增
- **重连后自动补齐**：WS 异常断开自动重连成功后，自动重新加载历史消息，补齐断线期间错过的消息；首次进入不重复加载，登出再登录复位标记不误判
- **手动刷新按钮**：顶栏新增刷新按钮（旋转箭头图标），点击重新加载历史消息，带 toast 反馈 + 800ms 防抖防重复点击

### 刷新按钮与状态点合并优化
#### 优化
- **合并控件**：连接状态点嵌入刷新按钮**图标正中心**（8px 圆点绝对定位居中，带白描边），删除独立状态点，减少顶栏空间占用；按钮 title 动态显示「已连接/连接断开/连接中… · 点击刷新消息」
- **刷新反馈**：点击刷新时刷新图标旋转动画（0.6s linear infinite，`prefers-reduced-motion` 禁用），与 disabled 防抖并存，反馈清晰

### 刷新同步在线成员列表
#### 新增
- **刷新按钮同步刷新在线成员**：点击刷新时通过 WS 发送 `refresh_online` 消息，DO 收到后重新广播 `online_users` 事件，在线成员列表一并强制刷新（网络/WS 异常后状态可能不同步的兜底）

### 新消息音效提醒
#### 新增
- **收到新消息音效**：他人发消息时播放清脆双音提示（880→1320Hz「叮」，Web Audio API，复用同一 AudioContext），自己的消息不响
- **独立开关**：设置弹窗新增「新消息音效」开关，**默认关闭**，与「上下线提醒」「提示音效」相互独立，持久化到 localStorage

### 通知设置分组重组
#### 优化
- **设置弹窗开关分组**：「提示音效」标签过于通用，重组为明确分组——「上下线提醒」组（含「消息提示」「音效」两个子开关）+「新消息提醒」组（含「音效」子开关），语义清晰；开关 id 与读写逻辑零改动，已有设置不丢失

### 撤回交互改造
#### 优化
- **长按显示撤回**：撤回按钮不再常显示，长按自己未撤回的消息行（约 550ms）后显示，2 秒无交互自动隐藏；Pointer Events 统一鼠标/触屏，滚动时自动取消计时不阻塞滚动
- **图标化撤回**：按钮由文字改为垃圾桶 SVG 图标，hover 红色反馈，带淡入缩放动画（尊重 `prefers-reduced-motion`）
- **二次确认**：点击撤回图标弹出确认弹窗（「确定要撤回这条消息吗？」），确认才执行撤回，取消/Escape/点遮罩关闭；`deleteMessage` 撤回逻辑零改动
- **气泡宽度自适应**：`.msg-bubble` 改为 `width: fit-content`，宽度由内容决定，仅保留超长文本的溢出限制；左右对齐显式 flex-start/flex-end

### 撤回按钮回归常显优化
#### 优化
- **撤回按钮常显示**：取消长按显示逻辑（及对应 CSS 动画），避免显示/隐藏时界面抖动；按钮位置移到消息显示时间后面（`.msg-time-row` 时间行内），小尺寸低调
- **图标更换**：垃圾桶（删除）图标 → 撤回/返回风格弯箭头（类似 return/回车键），淡灰色 + hover 主色反馈，二次确认弹窗保留

### 确认弹窗规范化
#### 优化
- **标题居中**：chat 撤回确认弹窗与 admin 管理平台确认弹窗的标题均水平居中（仅作用于确认弹窗，不影响设置弹窗/创建用户弹窗的 space-between 布局）
- **文案精简**：admin 端 6 处确认文案（封禁/解封/删除用户/撤回/删除/批量删除）去除冗余说明句，保留变量，简洁明了
- **按钮统一**：取消 + 确认（chat 端撤回弹窗此前已符合，无改动）

### 注册邀请码功能
#### 新增
- **邀请码验证**：后端注册接口增加邀请码校验（`settings` 表存储 `invite_code_enabled` / `invite_code`，开启验证后注册必须提交正确邀请码，错误返回 400「邀请码不正确」）
- **注册表单邀请码输入框**：chat 注册模式下新增「邀请码（如有）」输入框，切换登录/注册时自动清空
- **管理平台邀请码设置区块**：admin 统计看板下方新增「邀请码设置」面板——开关（是否开启验证，自定义渐变 switch 控件）+ 邀请码输入框（maxlength 64）+ 保存按钮；进入管理页自动加载当前设置，保存提交 `PUT /api/admin/invite-settings`，成功 toast「已保存」，后端 400（如「开启邀请码验证时必须设置邀请码」「邀请码不能超过 64 个字符」）经 `handleError` toast 展示
- **数据库迁移**：`migrations/002_invite_settings.sql` 新增 `settings` 表（key/value）并预置默认值，需手动执行 `wrangler d1 execute loopv-chat-db --file=./migrations/002_invite_settings.sql`

### 注册界面与移动端修复
#### 修复
- **邀请码框按后端设置动态显示**：新增公开接口 `GET /api/invite-settings`（无需登录，仅返回 `{ enabled }` 不泄露邀请码），chat 前端加载时查询——后端未开启验证时注册界面不显示邀请码输入框，开启时注册模式显示、登录模式隐藏；接口失败静默降级为隐藏
- **移动端横向滚动条**：`.auth-view` 的 `overflow-y: auto` 会导致 `overflow-x` 被计算为 auto，内部 720px 装饰光斑 `.auth-glow` 在 375px 视口制造横向滚动；显式加 `overflow-x: hidden` 裁剪，认证卡片本身不溢出不受影响

### 禁用用户手动缩放
#### 新增
- **viewport 禁止缩放**：chat 页面 viewport meta 增加 `maximum-scale=1.0, user-scalable=no`
- **手势阻止兜底**：JS 阻止 `gesturestart`（iOS 捏合）、多指 `touchmove`、桌面双击缩放事件，彻底禁用用户手动缩放

### 魅族浏览器键盘空白修复
#### 修复
- **输入框与键盘间大片空白**：魅族等旧内核浏览器不支持 `100dvh`（回退 `100vh`），且虚拟键盘弹出时不收缩 layout viewport，flex 输入区下方残留空白。`.app` 高度改为百分比链路 + CSS 变量 `--app-h` 兜底，JS 监听 `visualViewport` resize 同步精确可视高度（px），键盘弹出时输入框紧贴键盘；桌面端与主流移动端无回归

### 上传大小按类型限制
#### 优化
- **分类型限制**：统一 50MB 限制改为按类型——头像 2MB / 图片 10MB / 音频 20MB / 视频 50MB（`UPLOAD_LIMIT` 常量，保留 `MAX_UPLOAD_SIZE` env 兼容）；非图片/音频/视频类型直接 400 拒绝
- **前端大小预检**：`handleFileSelected` 选择文件时按类型即时校验大小（与后端阈值一致），超限 toast 提示不进入上传；文件选择器 accept 过滤已具备（image/video/audio）

### 历史消息滚动加载更多
#### 新增
- **默认加载 50 条**：登录后保持拉取最新 50 条历史消息（`MAX_HISTORY`，后端默认 limit 同为 50），进入即滚到底部
- **触顶/下拉加载更早消息**：消息记录滚到最顶部后——桌面继续上滚 / 移动端继续下拉（56px 阈值手势）——自动追加更早 20 条历史（`OLDER_PAGE`），可反复加载直到全部消息
- **游标分页**：`GET /api/history` 新增可选 `before_id` 参数，与 `before`（created_at）组成 `(created_at, id)` 复合游标，同秒多条消息分页不漏取、不重复（旧仅 `before` 调用完全兼容）
- **滚动位置保持**：新消息在顶部插入（DOM 升序），插入后按内容增量修正 `scrollTop`（临时关闭 smooth 防跳动），视口阅读位置不回跳、不闪烁
- **到底提示**：没有更早消息时顶部 toast 一次性提示「没有更早的消息了」（`olderDone` 防重复）；刷新/重连重新加载后分页状态自动复位

### 管理平台消息分页 + 状态多选筛选
#### 新增
- **消息分页浏览全部历史**：管理平台"消息管理"不再只显示最新 100 条，改为每页 100 条 + 分页控件（「共 X 条」总数、「上一页/下一页」、跳页数字输入框直接输入页码），可浏览全部历史消息；末页删空后自动回退收敛到末页（防死循环），total=0 停在空态
- **列表内滚动 + 固定表头**：消息表改为固定高度滚动容器（`max-height: calc(100vh - 300px)` + 仅纵向滚动行），表头 `thead` sticky 吸顶（`border-collapse: separate` 规避 Safari sticky 背景失效 bug），筛选栏/工具栏/分页栏均不随消息行滚动；横向滑动保留（`min-width: 880px`）
- **翻页交互**：翻页后清空当前页勾选、滚动容器即时回到顶部；分页按钮首页/末页禁用态、跳页输入框越界收敛 1..totalPages
- **消息状态多选筛选**：单选下拉改为 4 个可多选 chip（正常/用户撤回/管理员撤回/已删除，带与徽章配色的状态色点），勾选即"只显示这些状态"，全部不勾选 = 全部；筛选条件（时间/发送者/状态）变化时页码自动重置为 1
#### 后端
- `GET /api/admin/messages` 新增 `page` 参数（默认 1）与返回字段 `total`/`page`/`limit`/`totalPages`（COUNT 同筛选条件 + OFFSET 参数绑定）；状态筛选新增 `statuses` 逗号分隔多值（`deleted IN (...)`，仅保留合法 0~3 并去重），旧单值 `status` 参数保持兼容

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

### 后续修复与增强

#### 修复
- **WebSocket 认证状态丢失**：改用 `serializeAttachment` 存储连接认证状态（替代内存 Map），修复 DO 休眠唤醒后误报「请登录」、账号错乱的问题
- **历史消息重复**：加载历史前先清空列表
- **撤回按钮抖动**：撤回按钮改为常显示，不再 hover 显示（避免布局抖动）

#### 新增
- **在线用户列表**：所有用户可见当前在线成员，桌面端侧边栏 + 移动端抽屉
- 管理员在在线列表中显示「管理员」徽章
- 用户连接/断开实时广播在线状态

### 管理平台增强

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

### 门户主页重设计

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

### 聊天室界面调整

#### 移除角色 tag
- 在线用户列表移除「管理员」徽章，不显示任何角色 tag
- 保留「（我）」标记

#### 时区显示功能
- 消息时间按用户设置的时区显示，默认东八区（Asia/Shanghai 北京时间）
- 设置弹窗新增「时区」下拉选择（19 个常用时区，中文名 + 动态 UTC 偏移）
- 时区设置持久化到 localStorage，保存后即时刷新已显示消息时间

### 安全加固

#### 修复的漏洞
- **任意文件上传 → 存储型 XSS**：`/api/upload` 增加危险 MIME 黑名单（`text/html`、`image/svg+xml`、`application/octet-stream` 等）+ 危险扩展名黑名单（`.html`、`.svg`、`.js`、`.xml` 等）双重拦截；头像上传拒绝 SVG；`/media/*` 响应加 `X-Content-Type-Options: nosniff`
- **登录/注册暴力破解**：新增 `RateLimiter` Durable Object，按 IP 限流（10 分钟 5 次失败锁定 15 分钟），登录/注册成功自动清零；锁定期间窗口过期不会绕过（固定保留 lockedUntil）
- **WebSocket 刷屏**：消息发送 800ms 节流、撤回 300ms 节流；消息内容限 5000 字符
- **media_url 协议注入**：后端 WS 仅允许 `/media/` 前缀（拒绝 `javascript:` 等协议），INSERT 与广播均使用过滤后的值；前端 file 链接 href 加白名单双保险
- **CORS 全开**：origin 白名单收窄为 `chat.loopv.net` / `admin.loopv.net` / `localhost` / `127.0.0.1`

#### 额外加固
- **管理平台**：admin API 仅允许通过 `admin.loopv.net` 域名访问（本地开发 localhost 放行），通过 chat 域名访问管理接口返回 403

### 昵称/头像同步修复

#### 修复
- **历史消息资料不同步**：修改昵称/头像后，同步 `UPDATE messages` 表中该用户的历史消息快照（nickname / avatar_url），历史消息即时显示最新资料
- **在线连接资料缓存**：修改资料后通过内部 `/profile-update` 通知 DO，刷新该用户所有在线 WebSocket 连接的 `serializeAttachment`，新消息与在线列表即时显示最新昵称/头像，无需重新连接
- **前端已渲染消息刷新**：消息行记录 `data-user-id`，新增 `refreshMessagesOfUser()` 局部更新该用户所有消息的昵称/头像；保存资料成功后立即刷新自己页面，DO 广播 `profile_updated` 事件让所有在线客户端同步更新
- **存量数据回填**：修复上线前的历史消息快照仍为旧资料，手动执行 D1 SQL 将 `messages` 表快照对齐到 `users` 表当前值

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

### 后续
- **聊天室下线**：chat.loopv.net 停止服务，代码保留在 `apps/chat/`，Worker 已删除
- 门户移除聊天室入口卡片，Terminal 命令更新
