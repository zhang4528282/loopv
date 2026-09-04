import { DurableObject } from "cloudflare:workers";

interface UserInfo {
  userId: number;
  nickname: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

// 每连接附件结构（Hibernation 安全：DO 休眠唤醒后仍可恢复，勿改回内存 Map）
interface AttachmentUser {
  lastSeen: number; // 最近一次收到该连接消息/心跳的时间（毫秒），供 alarm 巡检判断僵尸连接
  userId?: number; // auth 成功后才有
  nickname?: string;
  avatarUrl?: string | null;
  isAdmin?: boolean;
}

// 离线公告宽限 overlay 条目：连接断开后不立即广播下线，宽限期内重连视为闪断（静默）
interface ClosingInfo {
  userId: number;
  nickname: string;
  avatarUrl: string | null;
  expiresAt: number; // 毫秒时间戳，到期仍无该用户重新认证则公告下线
}

// ===== 心跳 / 僵尸收割 / 下线公告宽限 参数 =====
const HEARTBEAT_INTERVAL_MS = 30_000; // 客户端心跳周期（app.js 保持一致）
const SWEEP_INTERVAL_MS = 60_000; // DO alarm 周期巡检间隔
const IDLE_TIMEOUT_MS = 90_000; // 连接超过该时长无任何消息 → 判定僵尸主动 close
const OFFLINE_GRACE_MS = 10_000; // 断开后公告下线的宽限期
const CLOSING_KEY = "closing_grace"; // 宽限 overlay 的 storage key

export class ChatRoom extends DurableObject {
  private env: Env;
  private lastSendAt = new Map<number, number>(); // userId -> 毫秒时间戳

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
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
            const u = sock.deserializeAttachment() as AttachmentUser | undefined;
            if (u && u.userId === userId) {
              sock.serializeAttachment({ ...u, nickname, avatarUrl });
            }
          } catch {
            // 忽略无法读取状态的连接
          }
        }
        await this.broadcastOnlineUsers();
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

    // 内部踢出请求（封禁/删除用户/注销/改密后由 worker 调用，断开该用户全部在线连接）
    if (url.pathname === "/kick" && request.method === "POST") {
      try {
        const { userId, reason } = await request.json();
        for (const sock of this.ctx.getWebSockets()) {
          try {
            const u = sock.deserializeAttachment() as UserInfo | undefined;
            if (u && u.userId === userId) {
              sock.send(JSON.stringify({ type: "kick", reason }));
              sock.close(4001, String(reason || "kicked"));
            }
          } catch { /* 忽略单连接失败 */ }
        }
      } catch (e) {
        console.error("kick error:", e);
      }
      return new Response("ok");
    }

    // WebSocket 升级
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    // 立即写入占位活跃时间：未认证/长期静默的连接也能被 alarm 巡检识别并收割
    server.serializeAttachment({ lastSeen: Date.now() });
    // 只要有连接就保证有一个巡检 alarm 武装着（DO 休眠时 alarm 也会唤醒）
    await this.ensureSweepArmed();

    return new Response(null, { status: 101, webSocket: client });
  }

  // 确保存在周期巡检 alarm（用于僵尸连接收割与宽限期到期处理）
  private async ensureSweepArmed(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing == null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string): Promise<void> {
    try {
      // 每次收到消息都刷新该连接活跃时间（客户端心跳与此共用同一入口）
      const att = ws.deserializeAttachment() as AttachmentUser | undefined;
      if (att) {
        ws.serializeAttachment({ ...att, lastSeen: Date.now() });
      }
      const data = JSON.parse(raw);

      switch (data.type) {
        case "ping": {
          // 客户端心跳：活跃时间已在上方刷新，无需其它处理
          break;
        }
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
        case "refresh_online": {
          // 客户端手动刷新在线成员列表（兜底，网络/WS 异常后状态可能不同步）
          await this.broadcastOnlineUsers();
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
    ws.serializeAttachment({
      lastSeen: Date.now(),
      userId: user.userId,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      isAdmin: user.isAdmin,
    });
    ws.send(
      JSON.stringify({
        type: "auth_ok",
        userId: user.userId,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        isAdmin: user.isAdmin,
      })
    );

    // 若该用户在离线公告宽限期内（刚断又连 = 闪断/刷新页面）：从 overlay 移除，
    // 视为从未离线——不广播 user_online，他人不会看到「下线了→上线了」噪音。
    const grace = await this.getClosingMap();
    const inGrace = grace[user.userId] != null;
    if (inGrace) {
      delete grace[user.userId];
      await this.ctx.storage.put(CLOSING_KEY, JSON.stringify(grace));
    }

    // 排除自身后是否仍有该用户的其他在线连接（多标签页不重复广播上线）
    const hasOtherConn = this.getOnlineUsers(ws).some(
      (u) => u.userId === user.userId
    );

    await this.broadcastOnlineUsers();
    // 仅当用户第一次上线（无其他连接）且不在宽限期时广播上线事件
    if (!hasOtherConn && !inGrace) {
      this.broadcast({
        type: "user_online",
        user: {
          userId: user.userId,
          nickname: user.nickname,
          avatarUrl: user.avatarUrl,
        },
      });
    }
  }

  // 获取当前真实在线用户（按 userId 去重，一个用户可多端连接）
  // exclude: 正在关闭的 socket（webSocketClose 里判断时，该 socket 可能仍被 getWebSockets() 返回）
  private getOnlineUsers(exclude?: WebSocket): UserInfo[] {
    const users = new Map<number, UserInfo>();
    for (const sock of this.ctx.getWebSockets()) {
      if (sock === exclude) continue;
      try {
        const att = sock.deserializeAttachment() as AttachmentUser | undefined;
        if (att && att.userId != null && !users.has(att.userId)) {
          users.set(att.userId, {
            userId: att.userId,
            nickname: att.nickname ?? "匿名",
            avatarUrl: att.avatarUrl ?? null,
            isAdmin: !!att.isAdmin,
          });
        }
      } catch {
        // 忽略无法读取状态的连接
      }
    }
    return Array.from(users.values());
  }

  // 读取离线公告宽限 overlay（storage 持久化，跨 DO 休眠存活）
  private async getClosingMap(): Promise<Record<string, ClosingInfo>> {
    try {
      const raw = await this.ctx.storage.get<string>(CLOSING_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  // 广播在线用户列表（真实在线 + 宽限期内未公告下线的用户，避免列表闪烁）
  private async broadcastOnlineUsers(): Promise<void> {
    const users = new Map<number, UserInfo>();
    for (const u of this.getOnlineUsers()) {
      users.set(u.userId, u);
    }
    const grace = await this.getClosingMap();
    for (const info of Object.values(grace)) {
      if (!users.has(info.userId)) {
        users.set(info.userId, {
          userId: info.userId,
          nickname: info.nickname,
          avatarUrl: info.avatarUrl,
          isAdmin: false,
        });
      }
    }
    this.broadcast({
      type: "online_users",
      count: users.size,
      users: Array.from(users.values()).map((u) => ({
        userId: u.userId,
        nickname: u.nickname,
        avatarUrl: u.avatarUrl,
        isAdmin: u.isAdmin,
      })),
    });
  }

  // 安排一次不早于 minDelay 毫秒后的 alarm；若已有更早的 alarm 则不动（避免推迟到期处理）
  private async scheduleAlarm(minDelay: number): Promise<void> {
    const target = Date.now() + minDelay;
    const existing = await this.ctx.storage.getAlarm();
    if (existing == null || existing > target) {
      await this.ctx.storage.setAlarm(target);
    }
  }

  // 发送消息
  private async handleMessage(ws: WebSocket, data: any): Promise<void> {
    const att = ws.deserializeAttachment() as AttachmentUser | undefined;
    if (!att || att.userId == null) {
      ws.send(JSON.stringify({ type: "error", message: "请先登录" }));
      return;
    }
    const user: UserInfo = {
      userId: att.userId,
      nickname: att.nickname ?? "匿名",
      avatarUrl: att.avatarUrl ?? null,
      isAdmin: !!att.isAdmin,
    };

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
    const att = ws.deserializeAttachment() as AttachmentUser | undefined;
    if (!att || att.userId == null) {
      ws.send(JSON.stringify({ type: "error", message: "请先登录" }));
      return;
    }
    const user: UserInfo = {
      userId: att.userId,
      nickname: att.nickname ?? "匿名",
      avatarUrl: att.avatarUrl ?? null,
      isAdmin: !!att.isAdmin,
    };

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
    // compat date ≥ 2026-04-07：runtime 已自动回复 Close 帧完成握手，无需手动 ws.close()

    let att: AttachmentUser | undefined;
    try {
      att = ws.deserializeAttachment() as AttachmentUser | undefined;
    } catch {
      // 无法读取附件信息则跳过
    }
    // 未完成认证的连接不影响在线状态
    if (!att || att.userId == null) return;

    // 排除自身后若该用户仍有其他在线连接（多标签页只关其一），不算下线，直接返回
    const stillOnline = this.getOnlineUsers(ws).some(
      (u) => u.userId === att.userId
    );
    if (stillOnline) return;

    // 该用户唯一连接已断开：写入离线公告宽限 overlay。
    // 宽限期内重新认证则视为闪断/刷新页面（静默恢复，不产生噪音）；
    // 到期仍无则 alarm 负责广播 user_offline 并把该用户移出在线列表。
    const grace = await this.getClosingMap();
    grace[att.userId] = {
      userId: att.userId,
      nickname: att.nickname ?? "匿名",
      avatarUrl: att.avatarUrl ?? null,
      expiresAt: Date.now() + OFFLINE_GRACE_MS,
    };
    await this.ctx.storage.put(CLOSING_KEY, JSON.stringify(grace));
    await this.scheduleAlarm(OFFLINE_GRACE_MS);
  }

  // 周期巡检 alarm（DO 休眠时也会唤醒执行，Hibernation 架构下不能依赖 setTimeout）：
  // ① 宽限期到期仍无重新认证的用户 → 移出在线列表并广播 user_offline
  // ② 收割僵尸连接（超过 IDLE_TIMEOUT_MS 无任何消息，含从未认证的占位连接）
  async alarm(): Promise<void> {
    const now = Date.now();

    // ① 先处理已到期的宽限 overlay（列表移除与公告必须一致）
    const grace = await this.getClosingMap();
    const expired: ClosingInfo[] = [];
    for (const [uid, info] of Object.entries(grace)) {
      if (info.expiresAt <= now) {
        delete grace[uid];
        expired.push(info);
      }
    }
    if (expired.length) {
      await this.ctx.storage.put(CLOSING_KEY, JSON.stringify(grace));
      // overlay 已删除该用户 → 先刷列表让其消失，再逐个广播下线
      await this.broadcastOnlineUsers();
      for (const info of expired) {
        this.broadcast({
          type: "user_offline",
          user: {
            userId: info.userId,
            nickname: info.nickname,
            avatarUrl: info.avatarUrl,
          },
        });
      }
    }

    // ② 收割僵尸连接（close 触发的 webSocketClose 会随后把已认证用户放入宽限 overlay）
    for (const sock of this.ctx.getWebSockets()) {
      try {
        const att = sock.deserializeAttachment() as AttachmentUser | undefined;
        if (!att || now - att.lastSeen > IDLE_TIMEOUT_MS) {
          try {
            sock.close(4001, "heartbeat timeout");
          } catch {
            // 已关闭则忽略
          }
        }
      } catch {
        // 忽略无法读取状态的连接
      }
    }

    // ③ 重排下一次唤醒：重新读取 overlay（② 的 close 事件可能已追加条目），
    //    不能依赖本方法开头读到的旧 map
    const freshGrace = await this.getClosingMap();
    let target: number | null = null;
    if (this.ctx.getWebSockets().length > 0) {
      target = now + SWEEP_INTERVAL_MS;
    }
    for (const info of Object.values(freshGrace)) {
      target = target == null ? info.expiresAt : Math.min(target, info.expiresAt);
    }
    if (target != null) {
      await this.ctx.storage.setAlarm(target);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async webSocketError(ws: WebSocket, error: Error): Promise<void> {
    console.error("webSocketError:", error);
  }
}
