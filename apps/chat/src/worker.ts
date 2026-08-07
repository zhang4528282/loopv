import { Hono } from "hono";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";
import { ChatRoom } from "./chat-room";

export { ChatRoom };

type Bindings = {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  ASSETS: { fetch: typeof fetch };
  MAX_MESSAGES: string;
  MAX_UPLOAD_SIZE: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", cors({ origin: "*" }));
app.use("*", prettyJSON());

// ===================== WebSocket =====================

app.get("/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return c.json({ error: "Expected WebSocket" }, 400);
  }

  const roomId = c.req.query("room") || "general";
  const id = c.env.CHAT_ROOM.idFromName(roomId);
  const stub = c.env.CHAT_ROOM.get(id);
  return stub.fetch(c.req.raw);
});

// ===================== API =====================

// 获取历史消息
app.get("/api/history", async (c) => {
  const roomId = c.req.query("room") || "general";
  const before = parseInt(c.req.query("before") || "0");
  const limit = Math.min(
    parseInt(c.req.query("limit") || "50"),
    200
  );

  let query: D1PreparedStatement;
  if (before > 0) {
    query = c.env.DB.prepare(
      `SELECT * FROM messages WHERE room_id = ?1 AND created_at < ?2 ORDER BY created_at DESC LIMIT ?3`
    ).bind(roomId, before, limit);
  } else {
    query = c.env.DB.prepare(
      `SELECT * FROM messages WHERE room_id = ?1 ORDER BY created_at DESC LIMIT ?2`
    ).bind(roomId, limit);
  }

  const { results } = await query.all();
  return c.json({ messages: results.reverse() });
});

// HTTP fallback 发送消息（WebSocket 不可用时）
app.post("/api/send", async (c) => {
  const body = await c.req.json();
  const { nickname, avatar_seed, type, content, media_url, media_type } = body;

  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO messages (room_id, session_id, nickname, avatar_seed, type, content, media_url, media_type, created_at)
     VALUES ('general', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(
    body.session_id || "",
    nickname || "匿名",
    avatar_seed || "1",
    type || "text",
    content || "",
    media_url || null,
    media_type || null,
    now
  ).run();

  return c.json({ success: true, created_at: now });
});

// 上传文件到 R2
app.post("/api/upload", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file");

  if (!file || typeof file === "string") {
    return c.json({ error: "No file" }, 400);
  }

  const maxSize = parseInt(c.env.MAX_UPLOAD_SIZE || "52428800");
  if (file.size > maxSize) {
    return c.json({ error: "File too large", maxSize }, 413);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  await c.env.MEDIA_BUCKET.put(safeName, file.stream(), {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
      cacheControl: "public, max-age=31536000, immutable",
    },
  });

  const url = `/media/${safeName}`;
  return c.json({ url, filename: safeName, contentType: file.type, size: file.size });
});

// 提供 R2 中的媒体文件
app.get("/media/:filename", async (c) => {
  const filename = c.req.param("filename");
  const object = await c.env.MEDIA_BUCKET.get(filename);

  if (!object) return c.notFound();

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
});

// ===================== 静态文件 =====================

app.get("/api/*", (c) => c.json({ error: "Not found" }, 404));

export default app;
