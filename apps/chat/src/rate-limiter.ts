// 按 IP 的登录/注册限流器（Durable Object 持久化，防暴力破解）
// 10 分钟内最多 5 次失败，超过则锁定 15 分钟
import { DurableObject } from "cloudflare:workers";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface RateState {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

export class RateLimiter extends DurableObject {
  private async getState(key: string): Promise<RateState> {
    const s = await this.ctx.storage.get<RateState>(key);
    const now = Date.now();
    // 锁定中必须保留 lockedUntil，否则窗口过期会导致锁定被绕过
    if (s && s.lockedUntil > now) return s;
    if (!s || now - s.windowStart > WINDOW_MS) {
      return { count: 0, windowStart: now, lockedUntil: 0 };
    }
    return s;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const ip = url.searchParams.get("ip") || "unknown";
    const key = `rl:${ip}`;
    const now = Date.now();
    const action = url.pathname;

    // 确保存在周期清理 alarm（每天一次，惰性设置，首次访问时注册）
    const existingAlarm = await this.ctx.storage.getAlarm();
    if (existingAlarm === null) {
      await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
    }

    // 检查是否被锁定
    if (action === "/check") {
      const s = await this.getState(key);
      if (s.lockedUntil > now) {
        return Response.json({
          allowed: false,
          retryAfter: Math.ceil((s.lockedUntil - now) / 1000),
        });
      }
      return Response.json({ allowed: true });
    }

    // 记录一次失败
    if (action === "/hit") {
      const s = await this.getState(key);
      s.count += 1;
      if (s.count >= MAX_FAILURES) {
        s.lockedUntil = now + LOCK_MS;
      }
      await this.ctx.storage.put(key, s);
      return Response.json({
        allowed: s.lockedUntil <= now,
        retryAfter: s.lockedUntil > now ? Math.ceil((s.lockedUntil - now) / 1000) : 0,
      });
    }

    // 成功登录/注册后清除计数
    if (action === "/reset") {
      await this.ctx.storage.delete(key);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "not found" }, 404);
  }

  // DO Alarm：每天清理一次已过期且未处于锁定的限流键，避免 IP 记录长期残留
  async alarm(): Promise<void> {
    const now = Date.now();
    const keys = await this.ctx.storage.list();
    for (const [key, raw] of keys) {
      const s = raw as RateState | null;
      // 窗口已过期且锁定期也已结束的键才删除（勿破坏 getState 的锁定保留语义）
      if (s && s.lockedUntil <= now && now - s.windowStart > WINDOW_MS) {
        await this.ctx.storage.delete(key);
      }
    }
    // 安排下一次清理
    await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
  }
}
