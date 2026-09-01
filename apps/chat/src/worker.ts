import { Hono } from "hono";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";
import { ChatRoom } from "./chat-room";
import {
  generateSalt,
  generateToken,
  hashPassword,
  constantTimeEqual,
  SESSION_TTL,
} from "./auth";

export { ChatRoom };

type Bindings = {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  MAX_UPLOAD_SIZE: string;
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
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization"] }));
app.use("*", prettyJSON());

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
    .prepare(`SELECT id, username, nickname, avatar_url, is_admin, banned FROM users WHERE id = ?1`)
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

// 注册
app.post("/api/auth/register", async (c) => {
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
  if (password.length < 6 || password.length > 64) {
    return c.json({ error: "密码长度需在 6-64 个字符之间" }, 400);
  }
  if (nickname.length > 20) {
    return c.json({ error: "昵称长度不能超过 20 个字符" }, 400);
  }

  // 检查用户名是否已存在
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

  const user = await c.env.DB.prepare(
    `SELECT id, username, password_hash, salt, nickname, avatar_url, is_admin, banned FROM users WHERE username = ?1`
  )
    .bind(username)
    .first();

  if (!user) {
    return c.json({ error: "用户名或密码错误" }, 401);
  }

  if ((user.banned as number) === 1) {
    return c.json({ error: "账号已被封禁" }, 403);
  }

  const passwordHash = await hashPassword(password, user.salt as string);
  if (!constantTimeEqual(passwordHash, user.password_hash as string)) {
    return c.json({ error: "用户名或密码错误" }, 401);
  }

  const token = await createSession(c.env.DB, user.id as number);

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

  return c.json({ success: true, nickname });
});

// 上传头像
app.post("/api/user/avatar", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "请先登录" }, 401);

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return c.json({ error: "No file" }, 400);
  }

  const maxSize = parseInt(c.env.MAX_UPLOAD_SIZE || "52428800");
  if (file.size > maxSize) {
    return c.json({ error: "文件过大" }, 413);
  }

  // 仅允许图片
  if (!(file as File).type.startsWith("image/")) {
    return c.json({ error: "头像必须是图片" }, 400);
  }

  const ext = (file as File).name.split(".").pop()?.toLowerCase() || "png";
  const safeName = `avatar-${user.id}-${Date.now()}.${ext}`;

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

  return c.json({ success: true, avatar_url: url });
});

// ===================== 消息 API =====================

// 获取历史消息
app.get("/api/history", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);
  const before = parseInt(c.req.query("before") || "0");

  let query;
  if (before > 0) {
    query = c.env.DB.prepare(
      `SELECT id, user_id, nickname, avatar_url, type, content, media_url, media_type, deleted, created_at
       FROM messages WHERE created_at < ?1 ORDER BY created_at DESC LIMIT ?2`
    ).bind(before, limit);
  } else {
    query = c.env.DB.prepare(
      `SELECT id, user_id, nickname, avatar_url, type, content, media_url, media_type, deleted, created_at
       FROM messages ORDER BY created_at DESC LIMIT ?1`
    ).bind(limit);
  }

  const { results } = await query.all();
  return c.json({ messages: results.reverse() });
});

// 撤回消息（HTTP fallback）
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

  await c.env.DB.prepare(`UPDATE messages SET deleted = 1 WHERE id = ?1`)
    .bind(messageId)
    .run();

  return c.json({ success: true });
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

  const maxSize = parseInt(c.env.MAX_UPLOAD_SIZE || "52428800");
  if ((file as File).size > maxSize) {
    return c.json({ error: "文件过大" }, 413);
  }

  const ext = (file as File).name.split(".").pop()?.toLowerCase() || "bin";
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

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

  return new Response(object.body, { headers });
});

// ===================== 管理平台 API =====================

// 统计信息
app.get("/api/admin/stats", adminMiddleware, async (c) => {
  const userCount = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM users`).first();
  const messageCount = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM messages`).first();
  const deletedCount = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE deleted = 1`).first();

  return c.json({
    users: userCount?.cnt || 0,
    messages: messageCount?.cnt || 0,
    deleted: deletedCount?.cnt || 0,
  });
});

// 用户列表
app.get("/api/admin/users", adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, username, nickname, avatar_url, is_admin, banned, created_at FROM users ORDER BY id DESC`
  ).all();
  return c.json({ users: results });
});

// 消息列表
app.get("/api/admin/messages", adminMiddleware, async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 500);
  const { results } = await c.env.DB.prepare(
    `SELECT id, user_id, nickname, type, content, media_url, deleted, created_at FROM messages ORDER BY id DESC LIMIT ?1`
  )
    .bind(limit)
    .all();
  return c.json({ messages: results });
});

// 管理员删除消息
app.post("/api/admin/messages/:id/delete", adminMiddleware, async (c) => {
  const messageId = parseInt(c.req.param("id"));
  await c.env.DB.prepare(`UPDATE messages SET deleted = 1 WHERE id = ?1`)
    .bind(messageId)
    .run();
  return c.json({ success: true });
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

  // 封禁时删除其所有 session
  if (banned === 1) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`)
      .bind(userId)
      .run();
  }

  return c.json({ success: true, banned: banned === 1 });
});

// ===================== 静态资源 =====================

async function serveAsset(c: any, path: string) {
  const url = new URL(c.req.url);
  url.pathname = path;
  return c.env.ASSETS.fetch(new Request(url.toString()));
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
