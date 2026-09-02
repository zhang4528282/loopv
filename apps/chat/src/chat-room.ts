import { DurableObject } from "cloudflare:workers";

interface UserInfo {
  userId: number;
  nickname: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export class ChatRoom extends DurableObject {
  private env: Env;
  private lastSendAt = new Map<number, number>(); // userId -> 毫秒时间戳

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
    const url = new URL(request.url);

    // 内部广播请求（来自 admin API，用于实时推送撤回/删除事件）
    if (url.pathname === "/broadcast" && request.method === "POST") {
      try {
        const payload = await request.json();
        this.broadcast(payload);
      } catch (e) {
        console.error("broadcast error:", e);
      }
      return new Response("ok");
    }

    // 内部资料更新请求（昵称/头像变更后刷新对应连接的认证状态）
    if (url.pathname === "/profile-update" && request.method === "POST") {
      try {
        const { userId, nickname, avatarUrl } = await request.json();
        // 更新该用户所有在线连接的 attachment
        for (const sock of this.ctx.getWebSockets()) {
          try {
            const u = sock.deserializeAttachment() as UserInfo | undefined;
            if (u && u.userId === userId) {
              sock.serializeAttachment({ ...u, nickname, avatarUrl });
            }
          } catch {
            // 忽略无法读取状态的连接
          }
        }
        this.broadcastOnlineUsers();
        // 广播资料更新事件，让所有在线客户端即时刷新该用户的历史消息显示
        this.broadcast({
          type: "profile_updated",
          userId,
          nickname,
          avatarUrl,
        });
      } catch (e) {
        console.error("profile-update error:", e);
      }
      return new Response("ok");
    }

    // WebSocket 升级
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

    // 广播最新在线用户列表
    this.broadcastOnlineUsers();
  }

  // 获取当前在线用户（按 userId 去重，一个用户可多端连接）
  // exclude: 正在关闭的 socket（webSocketClose 里广播时，该 socket 仍可能被 getWebSockets() 返回）
  private getOnlineUsers(exclude?: WebSocket): UserInfo[] {
    const users = new Map<number, UserInfo>();
    for (const sock of this.ctx.getWebSockets()) {
      if (sock === exclude) continue;
      try {
        const user = sock.deserializeAttachment() as UserInfo | undefined;
        if (user && !users.has(user.userId)) {
          users.set(user.userId, user);
        }
      } catch {
        // 忽略无法读取状态的连接
      }
    }
    return Array.from(users.values());
  }

  // 广播在线用户列表
  private broadcastOnlineUsers(exclude?: WebSocket): void {
    const users = this.getOnlineUsers(exclude);
    this.broadcast({
      type: "online_users",
      count: users.length,
      users: users.map((u) => ({
        userId: u.userId,
        nickname: u.nickname,
        avatarUrl: u.avatarUrl,
        isAdmin: u.isAdmin,
      })),
    });
  }

  // 发送消息
  private async handleMessage(ws: WebSocket, data: any): Promise<void> {
    const user = ws.deserializeAttachment() as UserInfo | undefined;
    if (!user) {
      ws.send(JSON.stringify({ type: "error", message: "请先登录" }));
      return;
    }

    // 发送节流：同一用户 800ms 内最多发 1 条
    const nowMs = Date.now();
    const last = this.lastSendAt.get(user.userId) || 0;
    if (nowMs - last < 800) {
      ws.send(JSON.stringify({ type: "error", message: "发送太快，请稍候" }));
      return;
    }
    this.lastSendAt.set(user.userId, nowMs);

    // 内容长度限制
    if (typeof data.content === "string" && data.content.length > 5000) {
      ws.send(JSON.stringify({ type: "error", message: "消息内容过长" }));
      return;
    }

    // media_url 白名单：只允许本站 /media/ 路径，防止 javascript: 等协议注入
    let mediaUrl: string | null = null;
    if (typeof data.media_url === "string" && data.media_url.startsWith("/media/")) {
      mediaUrl = data.media_url;
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
        mediaUrl,
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
      media_url: mediaUrl,
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

    // 撤回节流：同一用户 300ms 内最多撤回 1 条
    const nowMs = Date.now();
    const last = this.lastSendAt.get(user.userId) || 0;
    if (nowMs - last < 300) {
      ws.send(JSON.stringify({ type: "error", message: "操作太快，请稍候" }));
      return;
    }
    this.lastSendAt.set(user.userId, nowMs);

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

    // 管理员撤回他人消息标记为 2（管理员撤回），否则 1（用户撤回）
    const deletedValue =
      user.isAdmin && (msg.user_id as number) !== user.userId ? 2 : 1;

    await this.env.DB.prepare(`UPDATE messages SET deleted = ?1 WHERE id = ?2`)
      .bind(deletedValue, messageId)
      .run();

    this.broadcast({
      type: "recall",
      id: messageId,
      by: deletedValue === 2 ? "admin" : "user",
    });
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
    // compat date < 2026-04-07 时必须手动回复 Close 帧完成握手，
    // 否则连接停留在 CLOSING 状态，getWebSockets() 仍返回它，在线列表无法移除离线用户
    try {
      ws.close(code, reason);
    } catch {
      // 连接已关闭，忽略
    }
    // 连接断开后广播最新在线用户列表
    // 排除自身：CLOSING 状态下 getWebSockets() 仍可能返回该 socket，不排除会导致离线用户残留
    this.broadcastOnlineUsers(ws);
  }

  async webSocketError(ws: WebSocket, error: Error): Promise<void> {
    console.error("webSocketError:", error);
  }
}
