import { Hono } from "hono";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";
import { ChatRoom } from "./chat-room";
import { RateLimiter } from "./rate-limiter";
import {
  generateSalt,
  generateToken,
  hashPassword,
  constantTimeEqual,
  SESSION_TTL,
} from "./auth";

export { ChatRoom, RateLimiter };

type Bindings = {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  MAX_UPLOAD_SIZE: string;
  // Cloudflare Pages Deploy Hook URL（可选）：docs.loopv.net 隐藏文档变更后触发重建
  DOCS_DEPLOY_HOOK?: string;
};

type Variables = {
  user: AuthUser | null;
};

interface AuthUser {
  id: number;
  username: string;
  nickname: string;
  avatar_url: string | null;
  is_admin: boolean;
  is_test: boolean;
}

// 危险 MIME 类型（可执行脚本，禁止上传）
const DANGEROUS_TYPES = new Set([
  "text/html", "text/xml", "application/xml", "application/xhtml+xml",
  "text/javascript", "application/javascript", "application/x-javascript",
  "image/svg+xml", "application/x-shockwave-flash", "application/octet-stream",
]);
// 危险扩展名（双保险：即使伪造 MIME 也拦下）
const DANGEROUS_EXTS = new Set([
  "html", "htm", "svg", "js", "mjs", "xml", "xhtml", "swf",
  "php", "shtml", "cgi", "jsp", "asp", "aspx",
]);

// 上传大小限制（按类型，单位字节）：头像 2MB / 图片 10MB / 音频 20MB / 视频 50MB
const UPLOAD_LIMIT = {
  avatar: 2 * 1024 * 1024,
  image: 10 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  video: 50 * 1024 * 1024,
};
const UPLOAD_LIMIT_MB: Record<string, number> = {
  avatar: 2,
  image: 10,
  audio: 20,
  video: 50,
};

// 密码最小长度（安全自审 G3：原 6 位下限过弱，统一提为 8）
const PASSWORD_MIN = 8;
// 隐私政策页地址（注册同意勾选提示参考用）
const PRIVACY_POLICY_URL = "https://docs.loopv.net/privacy-policy";
// settings 表中「已注销/被删用户名」列表的 key（value 为 JSON 字符串数组）
const DELETED_USERNAMES_KEY = "deleted_usernames";

// 读取注销/删除过的用户名列表（G2 username tombstone）：解析失败或无值均返回 []
async function getDeletedUsernames(db: D1Database): Promise<string[]> {
  try {
    const row = await db
      .prepare(`SELECT value FROM settings WHERE key = ?1`)
      .bind(DELETED_USERNAMES_KEY)
      .first();
    const raw = (row?.value as string) || "";
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s: unknown) => typeof s === "string")
      : [];
  } catch {
    return [];
  }
}

async function isUsernameDeleted(db: D1Database, username: string): Promise<boolean> {
  const list = await getDeletedUsernames(db);
  return list.includes(username);
}

async function addDeletedUsername(db: D1Database, username: string): Promise<void> {
  const list = await getDeletedUsernames(db);
  if (list.includes(username)) return;
  list.push(username);
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = ?2`
    )
    .bind(DELETED_USERNAMES_KEY, JSON.stringify(list))
    .run();
}

// 清理过期 session（登录/注册成功时顺带执行，F6）
async function cleanupExpiredSessions(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`DELETE FROM sessions WHERE expires_at < ?1`).bind(now).run();
}

// 按 `/media/<name>` 形式的 URL 删除 R2 对象（级联清理用，容错静默、不阻断主流程）
async function deleteR2ByUrl(env: Bindings, url: string): Promise<void> {
  try {
    const prefix = "/media/";
    if (!url.startsWith(prefix)) return;
    const name = url.slice(prefix.length);
    if (!name) return;
    await env.MEDIA_BUCKET.delete(name);
  } catch {
    // 删除失败仅静默跳过（对象残留不影响业务）
  }
}

// 通知 ChatRoom DO 强制某用户下线（封禁/注销/改密后实时生效，F2）
async function kickUser(env: Bindings, userId: number, reason: string): Promise<void> {
  try {
    const id = env.CHAT_ROOM.idFromName("main");
    const stub = env.CHAT_ROOM.get(id);
    await stub.fetch("https://internal/kick", {
      method: "POST",
      body: JSON.stringify({ userId, reason }),
    });
  } catch (e) {
    console.error("kickUser error:", e);
  }
}

// 全随机媒体文件名（F11）：generateToken 返回 64 位 hex，取前 32 位拼名，杜绝文件名可推测
function randomMediaName(ext: string, prefix = "m"): string {
  return `${prefix}-${generateToken().slice(0, 32)}.${ext}`;
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return "*";
      try {
        const host = new URL(origin).host;
        if (
          host === "chat.loopv.net" ||
          host === "admin.loopv.net" ||
          host.startsWith("localhost") ||
          host.startsWith("127.0.0.1")
        ) {
          return origin;
        }
      } catch {}
      return null;
    },
    allowHeaders: ["Content-Type", "Authorization"],
  })
);
app.use("*", prettyJSON());

// 安全响应头 + CSP（F8）：所有响应统一加基础安全头，HTML 响应附加 CSP
const CSP_VALUE =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' https://docs.loopv.net wss: ws:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

// 给任意 Response headers 应用安全头（Hono 中间件与 serveAsset 兜底共用，
// 因 ASSETS.fetch 返回的 Response 头可能不可变，静态 HTML 需在 serveAsset 重建响应）
function applySecurityHeaders(headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  const ct = headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    headers.set("Content-Security-Policy", CSP_VALUE);
  }
}

app.use("*", async (c, next) => {
  await next();
  try {
    applySecurityHeaders(c.res.headers);
  } catch {
    // 部分响应（流式/只读头等）不可变时静默跳过，静态资源由 serveAsset 兜底
  }
});

// ===================== 工具函数 =====================

function isAdminHost(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const host = c.req.header("host") || "";
  return host.startsWith("admin.");
}

function getTokenFromHeader(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const auth = c.req.header("Authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

function getClientIp(c: any): string {
  return (
    c.req.header("CF-Connecting-IP") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function rateLimit(
  c: any,
  action: "check" | "hit" | "reset"
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const id = c.env.RATE_LIMITER.idFromName(getClientIp(c));
  const stub = c.env.RATE_LIMITER.get(id);
  const res = await stub.fetch(
    `https://internal/${action}?ip=${encodeURIComponent(getClientIp(c))}`
  );
  return res.json();
}

async function getUserByToken(db: D1Database, token: string): Promise<AuthUser | null> {
  if (!token) return null;
  const session = await db
    .prepare(`SELECT user_id, expires_at FROM sessions WHERE token = ?1`)
    .bind(token)
    .first();
  if (!session) return null;

  const now = Math.floor(Date.now() / 1000);
  if ((session.expires_at as number) < now) return null;

  const user = await db
    .prepare(`SELECT id, username, nickname, avatar_url, is_admin, is_test, banned FROM users WHERE id = ?1`)
    .bind(session.user_id as number)
    .first();
  if (!user) return null;

  if ((user.banned as number) === 1) return null;

  return {
    id: user.id as number,
    username: user.username as string,
    nickname: user.nickname as string,
    avatar_url: (user.avatar_url as string) || null,
    is_admin: (user.is_admin as number) === 1,
    is_test: (user.is_test as number) === 1,
  };
}

// 认证中间件
async function authMiddleware(c: any, next: any) {
  const token = getTokenFromHeader(c);
  if (token) {
    const user = await getUserByToken(c.env.DB, token);
    c.set("user", user);
  } else {
    c.set("user", null);
  }
  await next();
}

// 管理员中间件
async function adminMiddleware(c: any, next: any) {
  // 仅允许通过 admin.loopv.net 访问管理 API（本地开发放行）
  const host = c.req.header("host") || "";
  const isDev =
    host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (!isDev && !host.startsWith("admin.")) {
    return c.json({ error: "无权限" }, 403);
  }
  const user = c.get("user");
  if (!user || !user.is_admin) {
    return c.json({ error: "无权限" }, 403);
  }
  await next();
}

app.use("*", authMiddleware);

// ===================== WebSocket =====================

app.get("/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return c.json({ error: "Expected WebSocket" }, 400);
  }
  const id = c.env.CHAT_ROOM.idFromName("main");
  const stub = c.env.CHAT_ROOM.get(id);
  return stub.fetch(c.req.raw);
});

// ===================== 认证 API =====================

// 公开接口：查询是否开启邀请码验证（注册界面据此显示/隐藏邀请码输入框，无需登录）
app.get("/api/invite-settings", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT value FROM settings WHERE key = ?1`
  )
    .bind("invite_code_enabled")
    .first();
  return c.json({ enabled: (row?.value as string) === "1" });
});

// 公开接口：查询 docs.loopv.net 被隐藏的文档 slug 列表（docs 静态站构建/运行时调用，无需登录）
app.get("/api/docs/visibility", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT value FROM settings WHERE key = ?1`
  )
    .bind("docs_hidden")
    .first();
  const raw = (row?.value as string) || "";
  // value 为逗号分隔的 slug 字符串：split → 过滤空串 → 去重
  const hidden = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  return c.json({ hidden });
});

// 注册
app.post("/api/auth/register", async (c) => {
  const limit = await rateLimit(c, "check");
  if (!limit.allowed) {
    return c.json({ error: `尝试次数过多，请 ${limit.retryAfter} 秒后再试` }, 429);
  }

  const body = await c.req.json();
  const username = (body.username || "").trim();
  const password = body.password || "";
  const nickname = (body.nickname || "").trim() || username;

  // 注册前必须同意隐私政策（P1 合规）
  if (body.agreement !== true) {
    return c.json({ error: "请先阅读并同意《隐私政策》" }, 400);
  }
  if (!username || !password) {
    return c.json({ error: "用户名和密码不能为空" }, 400);
  }
  if (username.length < 2 || username.length > 20) {
    return c.json({ error: "用户名长度需在 2-20 个字符之间" }, 400);
  }
  if (password.length < PASSWORD_MIN || password.length > 64) {
    return c.json({ error: "密码长度需在 8-64 个字符之间" }, 400);
  }
  if (nickname.length > 20) {
    return c.json({ error: "昵称长度不能超过 20 个字符" }, 400);
  }

  // 邀请码验证（若已开启）
  const inviteSetting = await c.env.DB.prepare(
    `SELECT value FROM settings WHERE key = ?1`
  )
    .bind("invite_code_enabled")
    .first();
  const inviteEnabled = (inviteSetting?.value as string) === "1";
  if (inviteEnabled) {
    const codeRow = await c.env.DB.prepare(
      `SELECT value FROM settings WHERE key = ?1`
    )
      .bind("invite_code")
      .first();
    const validCode = (codeRow?.value as string) || "";
    const submittedCode = (body.invite_code || "").trim();
    if (!submittedCode || submittedCode !== validCode) {
      return c.json({ error: "邀请码不正确" }, 400);
    }
  }

  // 检查用户名是否已存在
  const existing = await c.env.DB.prepare(
    `SELECT id FROM users WHERE username = ?1`
  )
    .bind(username)
    .first();
  if (existing) {
    await rateLimit(c, "hit");
    return c.json({ error: "用户名已被占用" }, 409);
  }

  // 用户名 tombstone（G2）：注销/删除过的用户名不允许重新注册，防止历史归属混淆
  if (await isUsernameDeleted(c.env.DB, username)) {
    await rateLimit(c, "hit");
    return c.json({ error: "用户名已被占用" }, 409);
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  // 第一个注册的用户自动成为管理员
  const userCount = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM users`).first();
  const isAdmin = (userCount?.cnt as number) === 0 ? 1 : 0;

  const result = await c.env.DB.prepare(
    `INSERT INTO users (username, password_hash, salt, nickname, is_admin) VALUES (?1, ?2, ?3, ?4, ?5)`
  )
    .bind(username, passwordHash, salt, nickname, isAdmin)
    .run();

  const userId = result.meta.last_row_id ?? 0;
  const token = await createSession(c.env.DB, userId as number);

  // 顺带清理过期 session（F6）
  await cleanupExpiredSessions(c.env.DB);

  await rateLimit(c, "reset");

  return c.json({
    token,
    user: { id: userId, username, nickname, avatar_url: null, is_admin: isAdmin === 1 },
  });
});

// 登录
app.post("/api/auth/login", async (c) => {
  const body = await c.req.json();
  const username = (body.username || "").trim();
  const password = body.password || "";

  if (!username || !password) {
    return c.json({ error: "用户名和密码不能为空" }, 400);
  }

  const limit = await rateLimit(c, "check");
  if (!limit.allowed) {
    return c.json({ error: `尝试次数过多，请 ${limit.retryAfter} 秒后再试` }, 429);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, username, password_hash, salt, nickname, avatar_url, is_admin, banned FROM users WHERE username = ?1`
  )
    .bind(username)
    .first();

  if (!user) {
    await rateLimit(c, "hit");
    return c.json({ error: "用户名或密码错误" }, 401);
  }

  // 封禁用户与「用户不存在/密码错误」返回一致文案（F9 防枚举）
  if ((user.banned as number) === 1) {
    await rateLimit(c, "hit");
    return c.json({ error: "用户名或密码错误" }, 401);
  }

  const passwordHash = await hashPassword(password, user.salt as string);
  if (!constantTimeEqual(passwordHash, user.password_hash as string)) {
    await rateLimit(c, "hit");
    return c.json({ error: "用户名或密码错误" }, 401);
  }

  const token = await createSession(c.env.DB, user.id as number);

  // 顺带清理过期 session（F6）
  await cleanupExpiredSessions(c.env.DB);

  await rateLimit(c, "reset");

  return c.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      avatar_url: user.avatar_url,
      is_admin: (user.is_admin as number) === 1,
    },
  });
});

// 登出
app.post("/api/auth/logout", async (c) => {
  const token = getTokenFromHeader(c);
  if (token) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE token = ?1`).bind(token).run();
  }
  return c.json({ success: true });
});

// 获取当前用户
app.get("/api/auth/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ user: null });
  return c.json({ user });
});

// 用户自助注销（F3）：校验密码后删除全部数据并记录用户名 tombstone（管理员不支持）
app.post("/api/auth/delete-account", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "请先登录" }, 401);
  if (user.is_admin) {
    return c.json({ error: "管理员账号不支持自助注销" }, 403);
  }

  const body = await c.req.json();
  const password = body.password || "";

  // 校验密码
  const row = await c.env.DB.prepare(
    `SELECT username, password_hash, salt, avatar_url FROM users WHERE id = ?1`
  )
    .bind(user.id)
    .first();
  if (!row) return c.json({ error: "用户不存在" }, 404);
  const passwordHash = await hashPassword(password, row.salt as string);
  if (!constantTimeEqual(passwordHash, row.password_hash as string)) {
    return c.json({ error: "密码错误" }, 400);
  }

  // 级联清理 R2：头像 + 该用户所有消息附件，合并去重
  const mediaRows = await c.env.DB.prepare(
    `SELECT media_url FROM messages WHERE user_id = ?1 AND media_url IS NOT NULL`
  )
    .bind(user.id)
    .all();
  const urls = new Set<string>();
  if (row.avatar_url) urls.add(row.avatar_url as string);
  for (const m of mediaRows.results as Record<string, unknown>[]) {
    if (m.media_url) urls.add(m.media_url as string);
  }
  for (const url of urls) {
    await deleteR2ByUrl(c.env, url);
  }

  // 删除消息/会话/账号
  await c.env.DB.prepare(`DELETE FROM messages WHERE user_id = ?1`).bind(user.id).run();
  await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(user.id).run();
  await c.env.DB.prepare(`DELETE FROM users WHERE id = ?1`).bind(user.id).run();

  // 记录用户名 tombstone（G2），防止同名重新注册造成历史归属混淆
  await addDeletedUsername(c.env.DB, user.username);

  // 删除完成后踢下线其残留在线连接
  await kickUser(c.env, user.id, "deleted");

  return c.json({ success: true });
});

// 修改密码（G1）：成功后清空全部 session 并踢下线，强制重新登录
app.post("/api/auth/change-password", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "请先登录" }, 401);

  const body = await c.req.json();
  const oldPassword = body.old_password || "";
  const newPassword = body.new_password || "";
  if (!oldPassword || !newPassword) {
    return c.json({ error: "原密码和新密码不能为空" }, 400);
  }
  if (newPassword.length < PASSWORD_MIN || newPassword.length > 64) {
    return c.json({ error: "密码长度需在 8-64 个字符之间" }, 400);
  }
  if (oldPassword === newPassword) {
    return c.json({ error: "新密码不能与原密码相同" }, 400);
  }

  // 校验原密码
  const row = await c.env.DB.prepare(
    `SELECT password_hash, salt FROM users WHERE id = ?1`
  )
    .bind(user.id)
    .first();
  if (!row) return c.json({ error: "原密码错误" }, 400);
  const oldHash = await hashPassword(oldPassword, row.salt as string);
  if (!constantTimeEqual(oldHash, row.password_hash as string)) {
    return c.json({ error: "原密码错误" }, 400);
  }

  // 更新密码哈希
  const salt = generateSalt();
  const newHash = await hashPassword(newPassword, salt);
  await c.env.DB.prepare(`UPDATE users SET password_hash = ?1, salt = ?2 WHERE id = ?3`)
    .bind(newHash, salt, user.id)
    .run();

  // 全部会话失效 + 踢下线
  await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(user.id).run();
  await kickUser(c.env, user.id, "password_changed");

  return c.json({ success: true });
});

// 创建 session
async function createSession(db: D1Database, userId: number): Promise<string> {
  const token = generateToken();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)`
    )
    .bind(token, userId, now, now + SESSION_TTL)
    .run();
  return token;
}

// ===================== 用户资料 API =====================

// 修改昵称
app.put("/api/user/nickname", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "请先登录" }, 401);

  const body = await c.req.json();
  const nickname = (body.nickname || "").trim();
  if (!nickname) return c.json({ error: "昵称不能为空" }, 400);
  if (nickname.length > 20) return c.json({ error: "昵称长度不能超过 20 个字符" }, 400);

  await c.env.DB.prepare(`UPDATE users SET nickname = ?1 WHERE id = ?2`)
    .bind(nickname, user.id)
    .run();

  // 同步历史消息快照
  await c.env.DB.prepare(`UPDATE messages SET nickname = ?1 WHERE user_id = ?2`)
    .bind(nickname, user.id)
    .run();

  await notifyProfileUpdate(c.env, user.id, nickname, user.avatar_url);

  return c.json({ success: true, nickname });
});

// 上传头像
app.post("/api/user/avatar", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "请先登录" }, 401);
  // 保存旧头像 URL（UPDATE 前查询，成功替换后级联删除）
  const oldAvatarUrl = user.avatar_url;

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return c.json({ error: "No file" }, 400);
  }

  const maxSize = UPLOAD_LIMIT.avatar;
  if (file.size > maxSize) {
    return c.json({ error: "头像不能超过 2MB" }, 413);
  }

  // 仅允许图片（拒绝 SVG，防止 XSS）
  const avatarType = ((file as File).type || "").toLowerCase();
  if (!avatarType.startsWith("image/") || avatarType === "image/svg+xml") {
    return c.json({ error: "头像必须是图片" }, 400);
  }
  const ext = (file as File).name.split(".").pop()?.toLowerCase() || "png";
  if (ext === "svg") {
    return c.json({ error: "头像必须是图片" }, 400);
  }
  // 全随机文件名，不再含 userId/时间戳（F11 文件名不可推测）
  const safeName = randomMediaName(ext, "avatar");

  await c.env.MEDIA_BUCKET.put(safeName, (file as File).stream(), {
    httpMetadata: {
      contentType: (file as File).type || "image/png",
      cacheControl: "public, max-age=31536000, immutable",
    },
  });

  const url = `/media/${safeName}`;
  await c.env.DB.prepare(`UPDATE users SET avatar_url = ?1 WHERE id = ?2`)
    .bind(url, user.id)
    .run();

  // 同步历史消息快照
  await c.env.DB.prepare(`UPDATE messages SET avatar_url = ?1 WHERE user_id = ?2`)
    .bind(url, user.id)
    .run();

  await notifyProfileUpdate(c.env, user.id, user.nickname, url);

  // 成功替换后级联删除旧头像 R2 对象（F4），避免孤儿对象累积
  if (oldAvatarUrl && oldAvatarUrl.startsWith("/media/")) {
    await deleteR2ByUrl(c.env, oldAvatarUrl);
  }

  return c.json({ success: true, avatar_url: url });
});

// ===================== 消息 API =====================

// 获取历史消息（需登录；deleted=3 已删除的不返回，deleted=1/2 撤回的脱敏）
app.get("/api/history", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "请先登录" }, 401);

  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);
  const before = parseInt(c.req.query("before") || "0");
  const beforeId = parseInt(c.req.query("before_id") || "0");

  let query;
  if (before > 0 && beforeId > 0) {
    // 复合游标 (created_at, id)：用于加载更早消息，避免同一秒多条消息漏取/重复
    query = c.env.DB.prepare(
      `SELECT id, user_id, nickname, avatar_url, type, content, media_url, media_type, deleted, created_at
       FROM messages WHERE deleted != 3 AND (created_at < ?1 OR (created_at = ?1 AND id < ?2))
       ORDER BY created_at DESC, id DESC LIMIT ?3`
    ).bind(before, beforeId, limit);
  } else if (before > 0) {
    // 向后兼容：仅 before 游标
    query = c.env.DB.prepare(
      `SELECT id, user_id, nickname, avatar_url, type, content, media_url, media_type, deleted, created_at
       FROM messages WHERE deleted != 3 AND created_at < ?1 ORDER BY created_at DESC LIMIT ?2`
    ).bind(before, limit);
  } else {
    // 无游标：取最新消息
    query = c.env.DB.prepare(
      `SELECT id, user_id, nickname, avatar_url, type, content, media_url, media_type, deleted, created_at
       FROM messages WHERE deleted != 3 ORDER BY created_at DESC LIMIT ?1`
    ).bind(limit);
  }

  const { results } = await query.all();
  // F1 脱敏：撤回消息（deleted=1/2）不返回原文与媒体，仅保留元数据供前端渲染占位，
  // 防止匿名/非发送方通过翻页拉取已撤回内容
  const list = results as any[];
  for (const m of list) {
    if (m.deleted === 1 || m.deleted === 2) {
      m.content = null;
      m.media_url = null;
      m.media_type = null;
    }
  }
  return c.json({ messages: list.reverse() });
});

// 撤回消息（HTTP fallback）：用户撤回自己 deleted=1，管理员撤回 deleted=2
app.post("/api/messages/:id/delete", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "请先登录" }, 401);

  const messageId = parseInt(c.req.param("id"));

  const msg = await c.env.DB.prepare(
    `SELECT user_id, deleted FROM messages WHERE id = ?1`
  )
    .bind(messageId)
    .first();

  if (!msg) return c.json({ error: "消息不存在" }, 404);
  if (msg.deleted) return c.json({ success: true });
  if ((msg.user_id as number) !== user.id && !user.is_admin) {
    return c.json({ error: "只能撤回自己的消息" }, 403);
  }

  // 管理员撤回他人消息标记为 2（管理员撤回），否则 1（用户撤回）
  const deletedValue =
    user.is_admin && (msg.user_id as number) !== user.id ? 2 : 1;

  await c.env.DB.prepare(`UPDATE messages SET deleted = ?1 WHERE id = ?2`)
    .bind(deletedValue, messageId)
    .run();

  return c.json({ success: true, deleted: deletedValue });
});

// 上传媒体文件
app.post("/api/upload", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "请先登录" }, 401);

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return c.json({ error: "No file" }, 400);
  }

  const contentType = ((file as File).type || "").toLowerCase();
  // 按类型限制大小：图片 10MB / 音频 20MB / 视频 50MB
  let limitKey: "image" | "audio" | "video" | null = null;
  if (contentType.startsWith("image/")) limitKey = "image";
  else if (contentType.startsWith("audio/")) limitKey = "audio";
  else if (contentType.startsWith("video/")) limitKey = "video";
  if (!limitKey) {
    return c.json({ error: "仅支持图片、视频、音频文件" }, 400);
  }
  if ((file as File).size > UPLOAD_LIMIT[limitKey]) {
    return c.json({ error: `文件过大，${limitKey === "image" ? "图片" : limitKey === "audio" ? "音频" : "视频"}不能超过 ${UPLOAD_LIMIT_MB[limitKey]}MB` }, 413);
  }

  if (DANGEROUS_TYPES.has(contentType)) {
    return c.json({ error: "不支持的文件类型" }, 400);
  }
  const ext = (file as File).name.split(".").pop()?.toLowerCase() || "bin";
  if (DANGEROUS_EXTS.has(ext)) {
    return c.json({ error: "不支持的文件类型" }, 400);
  }
  // 全随机文件名，不再含时间戳（F11 文件名不可推测）
  const safeName = randomMediaName(ext);

  await c.env.MEDIA_BUCKET.put(safeName, (file as File).stream(), {
    httpMetadata: {
      contentType: (file as File).type || "application/octet-stream",
      cacheControl: "public, max-age=31536000, immutable",
    },
  });

  return c.json({
    url: `/media/${safeName}`,
    contentType: (file as File).type,
    size: (file as File).size,
  });
});

// 提供媒体文件
app.get("/media/:filename", async (c) => {
  const filename = c.req.param("filename");
  const object = await c.env.MEDIA_BUCKET.get(filename);
  if (!object) return c.notFound();

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(object.body, { headers });
});

// ===================== 管理平台 API =====================

// 通知 DO 广播事件（用于 admin 撤回/删除后实时推送）
async function notifyRoom(env: Bindings, payload: any) {
  try {
    const id = env.CHAT_ROOM.idFromName("main");
    const stub = env.CHAT_ROOM.get(id);
    await stub.fetch("https://internal/broadcast", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("notifyRoom error:", e);
  }
}

// 通知 DO 更新某用户的资料（昵称/头像变更后刷新在线连接的 attachment）
async function notifyProfileUpdate(
  env: Bindings,
  userId: number,
  nickname: string,
  avatarUrl: string | null
): Promise<void> {
  try {
    const id = env.CHAT_ROOM.idFromName("main");
    const stub = env.CHAT_ROOM.get(id);
    await stub.fetch("https://internal/profile-update", {
      method: "POST",
      body: JSON.stringify({ userId, nickname, avatarUrl }),
    });
  } catch (e) {
    console.error("notifyProfileUpdate error:", e);
  }
}

// 统计信息
app.get("/api/admin/stats", adminMiddleware, async (c) => {
  const userCount = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM users`).first();
  const messageCount = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM messages`).first();
  const recalledCount = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE deleted IN (1, 2)`).first();
  const deletedCount = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE deleted = 3`).first();

  return c.json({
    users: userCount?.cnt || 0,
    messages: messageCount?.cnt || 0,
    recalled: recalledCount?.cnt || 0,
    deleted: deletedCount?.cnt || 0,
  });
});

// 获取邀请码设置
app.get("/api/admin/invite-settings", adminMiddleware, async (c) => {
  const [enabledRow, codeRow] = await Promise.all([
    c.env.DB.prepare(`SELECT value FROM settings WHERE key = ?1`).bind("invite_code_enabled").first(),
    c.env.DB.prepare(`SELECT value FROM settings WHERE key = ?1`).bind("invite_code").first(),
  ]);
  return c.json({
    enabled: (enabledRow?.value as string) === "1",
    code: (codeRow?.value as string) || "",
  });
});

// 更新邀请码设置
app.put("/api/admin/invite-settings", adminMiddleware, async (c) => {
  const body = await c.req.json();
  const enabled = body.enabled ? "1" : "0";
  let code = (body.code || "").trim();
  if (code.length > 64) {
    return c.json({ error: "邀请码不能超过 64 个字符" }, 400);
  }
  // 开启时必须提供邀请码
  if (body.enabled && !code) {
    return c.json({ error: "开启邀请码验证时必须设置邀请码" }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = ?2`
  )
    .bind("invite_code_enabled", enabled)
    .run();
  await c.env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = ?2`
  )
    .bind("invite_code", code)
    .run();
  return c.json({ success: true, enabled: body.enabled, code });
});

// 更新 docs.loopv.net 隐藏文档列表（slug 白名单：小写字母/数字/连字符，最多 100 个）
app.put("/api/admin/docs", adminMiddleware, async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体不是合法 JSON" }, 400);
  }

  const hiddenInput = body?.hidden;
  // 校验：必须是字符串数组
  if (!Array.isArray(hiddenInput) || !hiddenInput.every((s) => typeof s === "string")) {
    return c.json({ error: "非法的文档标识" }, 400);
  }

  // 去重 + 校验 slug 格式（仅小写字母/数字/连字符）
  const hidden = [...new Set(hiddenInput)];
  for (const slug of hidden) {
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return c.json({ error: "非法的文档标识" }, 400);
    }
  }
  if (hidden.length > 100) {
    return c.json({ error: "数量过多" }, 400);
  }

  // 写入 settings：空数组也写入空字符串，避免残留旧值
  await c.env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = ?2`
  )
    .bind("docs_hidden", hidden.join(","))
    .run();

  // 触发 docs.loopv.net 重建（Pages Deploy Hook）：失败不报错，仅标记 hookFired: false
  let hookFired = false;
  const hookUrl = c.env.DOCS_DEPLOY_HOOK;
  if (hookUrl) {
    try {
      await fetch(hookUrl, { method: "POST" });
      hookFired = true;
    } catch (e) {
      console.error("docs deploy hook error:", e);
    }
  }

  return c.json({ ok: true, hidden, hookFired });
});

// 用户列表（支持筛选：username/nickname/role/status）
app.get("/api/admin/users", adminMiddleware, async (c) => {
  const username = c.req.query("username");
  const nickname = c.req.query("nickname");
  const role = c.req.query("role"); // admin | user | test
  const status = c.req.query("status"); // banned | normal

  const conditions: string[] = [];
  const params: any[] = [];

  if (username) {
    conditions.push("username LIKE ?");
    params.push(`%${username}%`);
  }
  if (nickname) {
    conditions.push("nickname LIKE ?");
    params.push(`%${nickname}%`);
  }
  if (role === "admin") {
    conditions.push("is_admin = 1");
  } else if (role === "test") {
    conditions.push("is_test = 1");
  } else if (role === "user") {
    conditions.push("is_admin = 0 AND is_test = 0");
  }
  if (status === "banned") {
    conditions.push("banned = 1");
  } else if (status === "normal") {
    conditions.push("banned = 0");
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  // F5：不返回 plain_password（测试用户明文密码仅限创建响应展示，列表不暴露）
  const { results } = await c.env.DB.prepare(
    `SELECT id, username, nickname, avatar_url, is_admin, is_test, banned, created_at FROM users ${where} ORDER BY id DESC`
  )
    .bind(...params)
    .all();
  return c.json({ users: results });
});

// 创建测试用户（is_test=1，返回明文密码供后台显示）
app.post("/api/admin/users", adminMiddleware, async (c) => {
  const body = await c.req.json();
  const username = (body.username || "").trim();
  const password = body.password || "";
  const nickname = (body.nickname || "").trim() || username;

  if (!username || !password) {
    return c.json({ error: "用户名和密码不能为空" }, 400);
  }
  if (username.length < 2 || username.length > 20) {
    return c.json({ error: "用户名长度需在 2-20 个字符之间" }, 400);
  }
  if (password.length < PASSWORD_MIN || password.length > 64) {
    return c.json({ error: "密码长度需在 8-64 个字符之间" }, 400);
  }
  if (nickname.length > 20) {
    return c.json({ error: "昵称长度不能超过 20 个字符" }, 400);
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM users WHERE username = ?1`
  )
    .bind(username)
    .first();
  if (existing) {
    return c.json({ error: "用户名已被占用" }, 409);
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  const result = await c.env.DB.prepare(
    `INSERT INTO users (username, password_hash, salt, nickname, is_test, plain_password) VALUES (?1, ?2, ?3, ?4, 1, ?5)`
  )
    .bind(username, passwordHash, salt, nickname, password)
    .run();

  const userId = result.meta.last_row_id ?? 0;
  return c.json({
    user: {
      id: userId,
      username,
      nickname,
      avatar_url: null,
      is_admin: 0,
      is_test: 1,
      plain_password: password,
      banned: 0,
    },
  });
});

// 删除用户（测试用户，不能删除管理员或自己）
app.delete("/api/admin/users/:id", adminMiddleware, async (c) => {
  const userId = parseInt(c.req.param("id"));
  const me = c.get("user");
  if (userId === me.id) {
    return c.json({ error: "不能删除自己的账号" }, 400);
  }

  const target = await c.env.DB.prepare(
    `SELECT username, is_admin FROM users WHERE id = ?1`
  )
    .bind(userId)
    .first();
  if (!target) {
    return c.json({ error: "用户不存在" }, 404);
  }
  if ((target.is_admin as number) === 1) {
    return c.json({ error: "不能删除管理员账号" }, 400);
  }

  // 记录被删用户名（G2 tombstone），防止同名重新注册造成历史归属混淆
  await addDeletedUsername(c.env.DB, target.username as string);

  await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(userId).run();
  await c.env.DB.prepare(`DELETE FROM users WHERE id = ?1`).bind(userId).run();

  // 删除完成后踢掉其残留在线连接（F2）
  await kickUser(c.env, userId, "deleted");

  return c.json({ success: true });
});

// 消息列表（支持筛选：statuses/status/sender/start/end；支持分页 page/limit）
app.get("/api/admin/messages", adminMiddleware, async (c) => {
  const rawLimit = parseInt(c.req.query("limit") || "100");
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 100 : rawLimit, 1), 500); // 页大小默认 100，上限 500
  const rawPage = parseInt(c.req.query("page") || "1");
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage; // 页码从 1 开始，非法/小于 1 按 1 处理
  const status = c.req.query("status"); // 0=正常 1=用户撤回 2=管理员撤回 3=已删除（旧单值，兼容）
  const statusesRaw = c.req.query("statuses"); // 逗号分隔多选，如 "0,1,2"
  const sender = c.req.query("sender");
  const start = parseInt(c.req.query("start") || "0");
  const end = parseInt(c.req.query("end") || "0");

  const conditions: string[] = [];
  const params: any[] = [];

  // 状态筛选：statuses 优先（仅保留合法 0~3 且去重），未提供时回退单值 status
  if (statusesRaw !== undefined && statusesRaw.trim() !== "") {
    const validStatuses = [
      ...new Set(
        statusesRaw
          .split(",")
          .map((s) => parseInt(s.trim()))
          .filter((n) => !isNaN(n) && n >= 0 && n <= 3)
      ),
    ];
    if (validStatuses.length > 0) {
      conditions.push(`deleted IN (${validStatuses.map(() => "?").join(",")})`);
      params.push(...validStatuses);
    }
  } else if (status !== undefined && status !== "") {
    const statusNum = parseInt(status);
    if (!isNaN(statusNum)) {
      conditions.push("deleted = ?");
      params.push(statusNum);
    }
  }
  if (sender) {
    conditions.push("nickname LIKE ?");
    params.push(`%${sender}%`);
  }
  if (start > 0) {
    conditions.push("created_at >= ?");
    params.push(start);
  }
  if (end > 0) {
    conditions.push("created_at <= ?");
    params.push(end);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  // 总数（同一套筛选条件）
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM messages ${where}`
  )
    .bind(...params)
    .first();
  const total = Number((countRow as any)?.cnt || 0);
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

  // 当前页数据（OFFSET 参数绑定，不拼接）
  const offset = (page - 1) * limit;
  params.push(limit, offset);
  const { results } = await c.env.DB.prepare(
    `SELECT id, user_id, nickname, type, content, media_url, deleted, created_at FROM messages ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  )
    .bind(...params)
    .all();
  return c.json({ messages: results, total, page, limit, totalPages });
});

// 管理员删除消息（deleted=3，chat 界面不显示；同时级联清理 R2 媒体，F4）
app.post("/api/admin/messages/:id/delete", adminMiddleware, async (c) => {
  const messageId = parseInt(c.req.param("id"));
  // 先取 media_url，UPDATE 后据此物理删除 R2 对象
  const msg = await c.env.DB.prepare(
    `SELECT media_url FROM messages WHERE id = ?1`
  )
    .bind(messageId)
    .first();
  if (msg) {
    await c.env.DB.prepare(`UPDATE messages SET deleted = 3 WHERE id = ?1`)
      .bind(messageId)
      .run();
    if (msg.media_url) {
      await deleteR2ByUrl(c.env, msg.media_url as string);
    }
  }
  await notifyRoom(c.env, { type: "remove", ids: [messageId] });
  return c.json({ success: true });
});

// 管理员撤回消息（deleted=2，chat 界面显示"已被管理员撤回"）
app.post("/api/admin/messages/:id/recall", adminMiddleware, async (c) => {
  const messageId = parseInt(c.req.param("id"));
  await c.env.DB.prepare(`UPDATE messages SET deleted = 2 WHERE id = ?1`)
    .bind(messageId)
    .run();
  await notifyRoom(c.env, { type: "recall", id: messageId, by: "admin" });
  return c.json({ success: true });
});

// 批量删除消息
app.post("/api/admin/messages/batch-delete", adminMiddleware, async (c) => {
  const body = await c.req.json();
  const ids = body.ids || [];
  if (!Array.isArray(ids) || !ids.length) {
    return c.json({ error: "ids 不能为空" }, 400);
  }

  const numericIds = ids.map((n: any) => parseInt(n)).filter((n: number) => !isNaN(n));
  if (!numericIds.length) {
    return c.json({ error: "ids 无效" }, 400);
  }

  const placeholders = numericIds.map(() => "?").join(",");

  // 先取待删消息的 media_url（去重），UPDATE 后逐个物理删除 R2 对象（F4）
  const mediaRows = await c.env.DB.prepare(
    `SELECT media_url FROM messages WHERE id IN (${placeholders}) AND media_url IS NOT NULL`
  )
    .bind(...numericIds)
    .all();
  const mediaUrls = [
    ...new Set(
      (mediaRows.results as Record<string, unknown>[])
        .map((m) => m.media_url as string)
        .filter(Boolean)
    ),
  ];

  await c.env.DB.prepare(
    `UPDATE messages SET deleted = 3 WHERE id IN (${placeholders})`
  )
    .bind(...numericIds)
    .run();

  for (const url of mediaUrls) {
    await deleteR2ByUrl(c.env, url);
  }

  await notifyRoom(c.env, { type: "remove", ids: numericIds });

  return c.json({ success: true, count: numericIds.length });
});

// 封禁/解封用户
app.post("/api/admin/users/:id/ban", adminMiddleware, async (c) => {
  const userId = parseInt(c.req.param("id"));
  const body = await c.req.json();
  const banned = body.banned ? 1 : 0;

  // 不能封禁自己
  const me = c.get("user");
  if (userId === me.id) {
    return c.json({ error: "不能操作自己的账号" }, 400);
  }

  await c.env.DB.prepare(`UPDATE users SET banned = ?1 WHERE id = ?2`)
    .bind(banned, userId)
    .run();

  // 封禁时删除其所有 session 并踢下线在线连接（F2 封禁即时生效）
  if (banned === 1) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`)
      .bind(userId)
      .run();
    await kickUser(c.env, userId, "banned");
  }

  return c.json({ success: true, banned: banned === 1 });
});

// ===================== 静态资源 =====================

async function serveAsset(c: any, path: string) {
  const url = new URL(c.req.url);
  url.pathname = path;
  const res = await c.env.ASSETS.fetch(new Request(url.toString()));
  // ASSETS.fetch 返回的 Response 头可能不可变（中间件 set 会失败），
  // 这里重建响应确保 HTML/CSS/JS 都带上安全头（含 HTML 的 CSP）
  const headers = new Headers(res.headers);
  applySecurityHeaders(headers);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

// chat 前端首页
app.get("/", async (c) => {
  if (isAdminHost(c)) {
    return serveAsset(c, "/admin/index.html");
  }
  return serveAsset(c, "/chat/index.html");
});

// 静态资源兜底
app.get("/*", async (c) => {
  const path = c.req.path;
  if (isAdminHost(c)) {
    if (path.startsWith("/admin/")) {
      return serveAsset(c, path);
    }
    // admin 的其他资源映射到 /admin/ 目录
    return serveAsset(c, `/admin${path}`);
  }
  // chat 资源映射到 /chat/ 目录
  return serveAsset(c, `/chat${path}`);
});

// API 404 兜底
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

export default app;
