import { DurableObject } from "cloudflare:workers";

interface Message {
  room_id: string;
  session_id: string;
  nickname: string;
  avatar_seed: string;
  type: "text" | "image" | "video" | "audio" | "emoji" | "file";
  content: string;
  media_url?: string;
  media_type?: string;
  created_at: number;
}

interface BroadcastPayload {
  type: "message";
  id: number;
  room_id: string;
  session_id: string;
  nickname: string;
  avatar_seed: string;
  msg_type: string;
  content: string;
  media_url?: string;
  media_type?: string;
  created_at: number;
}

export class ChatRoom extends DurableObject {
  private env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;

    // 启用 Hibernation API——空闲时不产生计费
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: "ping" }),
        JSON.stringify({ type: "pong" })
      )
    );
  }

  async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string): Promise<void> {
    try {
      const data: Message = JSON.parse(raw);
      const now = Date.now();

      // 存入 D1
      const result = await this.env.DB.prepare(
        `INSERT INTO messages (room_id, session_id, nickname, avatar_seed, type, content, media_url, media_type, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      )
        .bind(
          data.room_id || "general",
          data.session_id,
          data.nickname,
          data.avatar_seed,
          data.type || "text",
          data.content,
          data.media_url || null,
          data.media_type || null,
          now
        )
        .run();

      // 广播给所有在线客户端
      const broadcast: BroadcastPayload = {
        type: "message",
        id: result.meta.last_row_id ?? 0,
        room_id: data.room_id || "general",
        session_id: data.session_id,
        nickname: data.nickname,
        avatar_seed: data.avatar_seed,
        msg_type: data.type || "text",
        content: data.content,
        media_url: data.media_url,
        media_type: data.media_type,
        created_at: now,
      };

      const sockets = this.ctx.getWebSockets();
      const payload = JSON.stringify(broadcast);

      for (const sock of sockets) {
        try {
          sock.send(payload);
        } catch {
          // 发送失败则忽略（客户端可能已断开）
        }
      }
    } catch (e) {
      // 忽略无效消息
      console.error("webSocketMessage error:", e);
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    // Hibernation 模式下通常会在这里做清理
  }

  async webSocketError(ws: WebSocket, error: Error): Promise<void> {
    console.error("webSocketError:", error);
  }
}
