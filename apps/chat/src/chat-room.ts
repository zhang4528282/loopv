import { DurableObject } from "cloudflare:workers";

interface UserInfo {
  userId: number;
  nickname: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export class ChatRoom extends DurableObject {
  private env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;

    // Hibernation API 心跳
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
      const data = JSON.parse(raw);

      switch (data.type) {
        case "auth": {
          await this.handleAuth(ws, data.token);
          break;
        }
        case "message": {
          await this.handleMessage(ws, data);
          break;
        }
        case "delete": {
          await this.handleDelete(ws, data.id);
          break;
        }
      }
    } catch (e) {
      console.error("webSocketMessage error:", e);
    }
  }

  // 认证连接：用 serializeAttachment 存储用户信息（Hibernation 安全）
  private async handleAuth(ws: WebSocket, token: string): Promise<void> {
    const user = await this.getUserByToken(token);
    if (!user) {
      ws.send(
        JSON.stringify({ type: "auth_error", message: "登录已失效，请重新登录" })
      );
      ws.close(4001, "unauthorized");
      return;
    }
    // 关键：用 serializeAttachment 替代内存 Map，DO 休眠唤醒后仍能恢复
    ws.serializeAttachment(user);
    ws.send(
      JSON.stringify({
        type: "auth_ok",
        userId: user.userId,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        isAdmin: user.isAdmin,
      })
    );
  }

  // 发送消息
  private async handleMessage(ws: WebSocket, data: any): Promise<void> {
    const user = ws.deserializeAttachment() as UserInfo | undefined;
    if (!user) {
      ws.send(JSON.stringify({ type: "error", message: "请先登录" }));
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const type = ["text", "image", "video", "audio", "emoji", "file"].includes(
      data.msg_type
    )
      ? data.msg_type
      : "text";

    const result = await this.env.DB.prepare(
      `INSERT INTO messages (user_id, nickname, avatar_url, type, content, media_url, media_type, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
      .bind(
        user.userId,
        user.nickname,
        user.avatarUrl,
        type,
        data.content || "",
        data.media_url || null,
        data.media_type || null,
        now
      )
      .run();

    const messageId = result.meta.last_row_id ?? 0;

    this.broadcast({
      type: "message",
      id: messageId,
      user_id: user.userId,
      nickname: user.nickname,
      avatar_url: user.avatarUrl,
      msg_type: type,
      content: data.content || "",
      media_url: data.media_url || null,
      media_type: data.media_type || null,
      created_at: now,
    });
  }

  // 撤回消息
  private async handleDelete(ws: WebSocket, messageId: number): Promise<void> {
    const user = ws.deserializeAttachment() as UserInfo | undefined;
    if (!user) {
      ws.send(JSON.stringify({ type: "error", message: "请先登录" }));
      return;
    }

    const msg = await this.env.DB.prepare(
      `SELECT user_id, deleted FROM messages WHERE id = ?1`
    )
      .bind(messageId)
      .first();

    if (!msg) {
      ws.send(JSON.stringify({ type: "error", message: "消息不存在" }));
      return;
    }

    if (msg.deleted) {
      return;
    }

    // 只有消息作者或管理员能撤回
    if ((msg.user_id as number) !== user.userId && !user.isAdmin) {
      ws.send(JSON.stringify({ type: "error", message: "只能撤回自己的消息" }));
      return;
    }

    await this.env.DB.prepare(`UPDATE messages SET deleted = 1 WHERE id = ?1`)
      .bind(messageId)
      .run();

    this.broadcast({ type: "delete", id: messageId });
  }

  // 根据 token 查用户
  private async getUserByToken(token: string): Promise<UserInfo | null> {
    if (!token) return null;

    const session = await this.env.DB.prepare(
      `SELECT user_id, expires_at FROM sessions WHERE token = ?1`
    )
      .bind(token)
      .first();

    if (!session) return null;

    const now = Math.floor(Date.now() / 1000);
    if ((session.expires_at as number) < now) return null;

    const user = await this.env.DB.prepare(
      `SELECT id, nickname, avatar_url, is_admin, banned FROM users WHERE id = ?1`
    )
      .bind(session.user_id as number)
      .first();

    if (!user) return null;
    if ((user.banned as number) === 1) return null;

    return {
      userId: user.id as number,
      nickname: user.nickname as string,
      avatarUrl: (user.avatar_url as string) || null,
      isAdmin: (user.is_admin as number) === 1,
    };
  }

  // 广播
  private broadcast(payload: any): void {
    const data = JSON.stringify(payload);
    const sockets = this.ctx.getWebSockets();
    for (const sock of sockets) {
      try {
        sock.send(data);
      } catch {
        // 忽略发送失败
      }
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    // 无需清理：serializeAttachment 状态随连接自动释放
  }

  async webSocketError(ws: WebSocket, error: Error): Promise<void> {
    console.error("webSocketError:", error);
  }
}
