import net from "node:net";
import tls from "node:tls";

/**
 * Tier-1 In-Memory LRU Cache (<0.1 ms) + Tier-2 Optional Redis RESP Adapter.
 * If REDIS_URL is configured and reachable, reads/writes also sync to Redis;
 * otherwise runs seamlessly on Tier-1 Memory LRU with zero errors.
 */
export class TwoTierCache {
  constructor({ maxItems = 600, redisUrl = process.env.REDIS_URL || "" } = {}) {
    this.maxItems = maxItems;
    this.mem = new Map();
    this.redisUrl = redisUrl;
    this.redisStatus = redisUrl ? "connecting" : "not_configured";
    this.stats = {
      hits: 0,
      staleHits: 0,
      misses: 0,
      sets: 0,
      redisHits: 0,
      totalReadNs: 0,
      reads: 0,
    };
  }

  getMetrics() {
    const avgReadMs = this.stats.reads > 0 ? this.stats.totalReadNs / this.stats.reads / 1e6 : 0;
    const total = this.stats.hits + this.stats.staleHits + this.stats.misses;
    return {
      items: this.mem.size,
      maxItems: this.maxItems,
      hits: this.stats.hits,
      staleHits: this.stats.staleHits,
      misses: this.stats.misses,
      hitRatio: total > 0 ? Number(((this.stats.hits + this.stats.staleHits) / total).toFixed(3)) : 0,
      avgReadMs: Number(avgReadMs.toFixed(4)),
      redis: this.redisStatus,
      redisHits: this.stats.redisHits,
    };
  }

  get(key, { allowStale = false } = {}) {
    const t0 = process.hrtime.bigint();
    const entry = this.mem.get(key);
    this.stats.reads++;
    if (!entry) {
      this.stats.misses++;
      this.stats.totalReadNs += Number(process.hrtime.bigint() - t0);
      return null;
    }
    const now = Date.now();
    // Touch LRU order
    this.mem.delete(key);
    this.mem.set(key, entry);

    if (now <= entry.expiresAt) {
      this.stats.hits++;
      this.stats.totalReadNs += Number(process.hrtime.bigint() - t0);
      return { value: entry.value, stale: false };
    }
    if (allowStale && now <= entry.staleUntil) {
      this.stats.staleHits++;
      this.stats.totalReadNs += Number(process.hrtime.bigint() - t0);
      return { value: entry.value, stale: true };
    }
    this.mem.delete(key);
    this.stats.misses++;
    this.stats.totalReadNs += Number(process.hrtime.bigint() - t0);
    return null;
  }

  set(key, value, ttlSec, staleSec = 300) {
    if (ttlSec <= 0) return;
    if (this.mem.size >= this.maxItems) {
      const oldest = this.mem.keys().next().value;
      if (oldest !== undefined) this.mem.delete(oldest);
    }
    const now = Date.now();
    this.mem.set(key, {
      value,
      expiresAt: now + ttlSec * 1000,
      staleUntil: now + (ttlSec + staleSec) * 1000,
    });
    this.stats.sets++;

    if (this.redisUrl) {
      this._redisSet(key, value, ttlSec + staleSec).catch(() => {});
    }
  }

  async getWithRedisFallback(key, opts = {}) {
    const local = this.get(key, opts);
    if (local) return local;
    if (!this.redisUrl) return null;
    try {
      const raw = await this._redisGet(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      this.stats.redisHits++;
      this.mem.set(key, parsed);
      return { value: parsed.value, stale: Date.now() > parsed.expiresAt };
    } catch {
      return null;
    }
  }

  async _redisCmd(args) {
    if (!this.redisUrl) return null;
    const u = new URL(this.redisUrl);
    const isTls = u.protocol === "rediss:";
    const port = Number(u.port) || 6379;
    const host = u.hostname;
    const pass = decodeURIComponent(u.password || "");

    const encode = (cmdArgs) => {
      let out = `*${cmdArgs.length}\r\n`;
      for (const a of cmdArgs) {
        const s = String(a);
        out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
      }
      return out;
    };

    return new Promise((resolve, reject) => {
      const sock = isTls ? tls.connect(port, host) : net.connect(port, host);
      let buf = "";
      const timer = setTimeout(() => {
        sock.destroy();
        this.redisStatus = "unreachable";
        reject(new Error("Redis timeout"));
      }, 600);

      sock.on("connect", () => {
        this.redisStatus = "connected";
        if (pass) sock.write(encode(["AUTH", pass]));
        sock.write(encode(args));
      });
      sock.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        if (buf.includes("\r\n")) {
          clearTimeout(timer);
          sock.end();
          resolve(buf);
        }
      });
      sock.on("error", (err) => {
        clearTimeout(timer);
        this.redisStatus = "error";
        reject(err);
      });
    });
  }

  async _redisGet(key) {
    const resp = await this._redisCmd(["GET", `ist:${key}`]);
    if (!resp || resp.startsWith("$-1")) return null;
    const parts = resp.split("\r\n");
    return parts.length >= 2 ? parts[1] : null;
  }

  async _redisSet(key, value, ttlSec) {
    const now = Date.now();
    const payload = JSON.stringify({
      value,
      expiresAt: now + ttlSec * 1000,
      staleUntil: now + ttlSec * 1000,
    });
    await this._redisCmd(["SET", `ist:${key}`, payload, "EX", String(Math.max(1, Math.round(ttlSec)))]);
  }
}

export const sharedCache = new TwoTierCache();
