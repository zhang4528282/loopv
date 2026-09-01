// 按 IP 的登录/注册限流器（Durable Object 持久化，防暴力破解）
// 10 分钟内最多 5 次失败，超过则锁定 15 分钟
import { DurableObject } from "cloudflare:workers";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

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
}
