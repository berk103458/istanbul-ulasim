/**
 * API Gateway:
 * - In-flight Request Coalescing (deduplicates concurrent identical upstream calls)
 * - Token-bucket Rate Limiter per IP
 * - Per-provider Circuit Breaker & Automatic Failover tracking
 * - Rolling p50 / p95 / p99 Latency, Memory & CPU Observability
 */
export class ApiGateway {
  constructor({ rateLimitRpm = Number(process.env.RATE_LIMIT_RPM) || 300 } = {}) {
    this.inFlight = new Map();
    this.rateBuckets = new Map();
    this.rateLimitRpm = rateLimitRpm;
    this.breakers = new Map();
    this.latencies = [];
    this.maxLatencies = 1000;
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.coalescedCount = 0;
    this.startedAt = Date.now();
  }

  detectProvider(url) {
    const u = String(url || "").toLowerCase();
    if (u.includes("api.ibb.gov.tr/iett")) return "iett";
    if (u.includes("metroistanbul")) return "metro";
    if (u.includes("tkmservices.ibb.gov.tr")) return "tkm";
    if (u.includes("sehirhatlari.istanbul")) return "sehirhatlari";
    if (u.includes("ispark")) return "ispark";
    if (u.includes("transitous.org")) return "transitous";
    if (u.includes("googleapis.com")) return "google";
    return "other";
  }

  checkRateLimit(ip) {
    const key = ip || "unknown";
    const now = Date.now();
    let b = this.rateBuckets.get(key);
    if (!b) {
      b = { tokens: this.rateLimitRpm, last: now };
      this.rateBuckets.set(key, b);
    }
    const elapsedMin = (now - b.last) / 60000;
    b.tokens = Math.min(this.rateLimitRpm, b.tokens + elapsedMin * this.rateLimitRpm);
    b.last = now;
    if (b.tokens < 1) {
      return { allowed: false, retryAfterSec: Math.ceil((1 - b.tokens) * (60 / this.rateLimitRpm)) };
    }
    b.tokens -= 1;
    return { allowed: true, remaining: Math.floor(b.tokens) };
  }

  _getBreaker(provider) {
    let br = this.breakers.get(provider);
    if (!br) {
      br = { state: "CLOSED", failures: 0, lastFailureAt: 0, openUntil: 0, successes: 0 };
      this.breakers.set(provider, br);
    }
    if (br.state === "OPEN" && Date.now() > br.openUntil) {
      br.state = "HALF_OPEN";
    }
    return br;
  }

  isCircuitOpen(provider) {
    return this._getBreaker(provider).state === "OPEN";
  }

  recordSuccess(provider, latencyMs) {
    const br = this._getBreaker(provider);
    br.state = "CLOSED";
    br.failures = 0;
    br.successes++;
    this.recordRequestLatency(latencyMs, false);
  }

  recordFailure(provider, latencyMs) {
    const br = this._getBreaker(provider);
    br.failures++;
    br.lastFailureAt = Date.now();
    if (br.failures >= 4) {
      br.state = "OPEN";
      br.openUntil = Date.now() + 20000;
    }
    this.recordRequestLatency(latencyMs, true);
  }

  recordRequestLatency(ms, isError = false) {
    this.totalRequests++;
    if (isError) this.totalErrors++;
    if (this.latencies.length >= this.maxLatencies) this.latencies.shift();
    this.latencies.push(ms);
  }

  async coalesce(key, fn) {
    if (this.inFlight.has(key)) {
      this.coalescedCount++;
      return this.inFlight.get(key);
    }
    const p = Promise.resolve()
      .then(fn)
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, p);
    return p;
  }

  getMetrics(cacheStats) {
    const sorted = this.latencies.slice().sort((a, b) => a - b);
    const pct = (q) => (sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(2)) : 0);
    const mem = process.memoryUsage();
    const providers = {};
    for (const [k, v] of this.breakers.entries()) {
      providers[k] = { state: v.state, failures: v.failures, successes: v.successes };
    }
    return {
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      requests: {
        total: this.totalRequests,
        errors: this.totalErrors,
        coalesced: this.coalescedCount,
        inFlight: this.inFlight.size,
      },
      latencyMs: {
        p50: pct(0.5),
        p95: pct(0.95),
        p99: pct(0.99),
      },
      cache: cacheStats,
      providers,
      system: {
        heapUsedMB: Number((mem.heapUsed / 1048576).toFixed(1)),
        rssMB: Number((mem.rss / 1048576).toFixed(1)),
      },
    };
  }
}

export const gateway = new ApiGateway();
