export type PublicOrigin = {
  host: string;
  origin: string;
  protocol: "http" | "https";
};

type ParsedPublicAddress = {
  host: string;
  protocol: "http" | "https";
};

function parsePublicAddress(value?: string | null): ParsedPublicAddress | null {
  const input = value?.trim();
  if (!input) return null;

  try {
    const address = /^[a-z][a-z\d+.-]*:\/\//i.test(input)
      ? input
      : `https://${input}`;
    const url = new URL(address);

    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    if (!url.hostname || url.hostname.length > 253) return null;

    const isDnsOrIpv4 = /^[a-z\d.-]+$/i.test(url.hostname);
    const isIpv6 = /^\[[a-f\d:.]+\]$/i.test(url.hostname);
    if (!isDnsOrIpv4 && !isIpv6) return null;

    return {
      host: url.host,
      protocol: url.protocol === "http:" ? "http" : "https",
    };
  } catch {
    return null;
  }
}

export function normalizePublicHost(value?: string | null): string | null {
  return parsePublicAddress(value)?.host ?? null;
}

export function resolvePublicOrigin(
  configuredDomain?: string | null,
  requestHost?: string | null,
  requestProtocol?: string | null,
): PublicOrigin {
  const configured = parsePublicAddress(configuredDomain);
  const request = parsePublicAddress(requestHost);
  const host = configured?.host ?? request?.host ?? "localhost:5000";
  const isLocalhost =
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:") ||
    host === "[::1]" ||
    host.startsWith("[::1]:");
  const safeRequestProtocol =
    requestProtocol === "http" || requestProtocol === "https"
      ? requestProtocol
      : null;
  const protocol =
    configured?.protocol ??
    safeRequestProtocol ??
    (isLocalhost ? "http" : "https");

  return {
    host,
    protocol,
    origin: `${protocol}://${host}`,
  };
}

export type ConnectionLimitOptions = {
  maxActiveTotal: number;
  maxActivePerKey: number;
  maxAttemptsTotalPerWindow: number;
  maxAttemptsPerWindow: number;
  windowMs: number;
};

export type ConnectionLease =
  | {
      ok: true;
      release: () => void;
    }
  | {
      ok: false;
      status: 429 | 503;
      retryAfterSeconds: number;
      reason: string;
    };

type AttemptWindow = {
  count: number;
  startedAt: number;
};

export class ConnectionLimiter {
  private activeTotal = 0;
  private readonly activeByKey = new Map<string, number>();
  private readonly attemptsByKey = new Map<string, AttemptWindow>();
  private totalAttempts: AttemptWindow = { count: 0, startedAt: 0 };
  private lastAttemptSweepAt = 0;
  private readonly options: ConnectionLimitOptions;

  constructor(options: ConnectionLimitOptions) {
    if (
      options.maxActiveTotal < 1 ||
      options.maxActivePerKey < 1 ||
      options.maxAttemptsTotalPerWindow < 1 ||
      options.maxAttemptsPerWindow < 1 ||
      options.windowMs < 1
    ) {
      throw new Error("Connection limits must be positive");
    }
    this.options = options;
  }

  tryAcquire(rawKey: string, now = Date.now()): ConnectionLease {
    const key = rawKey.trim() || "unknown";
    this.pruneExpiredAttempts(now);

    if (now - this.totalAttempts.startedAt >= this.options.windowMs) {
      this.totalAttempts = { count: 0, startedAt: now };
    }
    if (
      this.totalAttempts.count >= this.options.maxAttemptsTotalPerWindow
    ) {
      return {
        ok: false,
        status: 429,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (this.options.windowMs -
              (now - this.totalAttempts.startedAt)) /
              1_000,
          ),
        ),
        reason: "SSE connection attempt capacity reached",
      };
    }
    this.totalAttempts.count += 1;

    let attempts = this.attemptsByKey.get(key);

    if (!attempts || now - attempts.startedAt >= this.options.windowMs) {
      attempts = { count: 0, startedAt: now };
      this.attemptsByKey.set(key, attempts);
    }

    if (attempts.count >= this.options.maxAttemptsPerWindow) {
      return {
        ok: false,
        status: 429,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (this.options.windowMs - (now - attempts.startedAt)) / 1_000,
          ),
        ),
        reason: "Too many connection attempts",
      };
    }
    attempts.count += 1;

    if (this.activeTotal >= this.options.maxActiveTotal) {
      return {
        ok: false,
        status: 503,
        retryAfterSeconds: 5,
        reason: "SSE connection capacity reached",
      };
    }

    const activeForKey = this.activeByKey.get(key) ?? 0;
    if (activeForKey >= this.options.maxActivePerKey) {
      return {
        ok: false,
        status: 429,
        retryAfterSeconds: 5,
        reason: "Too many active SSE connections",
      };
    }

    this.activeTotal += 1;
    this.activeByKey.set(key, activeForKey + 1);

    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.activeTotal -= 1;

        const remaining = (this.activeByKey.get(key) ?? 1) - 1;
        if (remaining > 0) {
          this.activeByKey.set(key, remaining);
        } else {
          this.activeByKey.delete(key);
        }
      },
    };
  }

  private pruneExpiredAttempts(now: number): void {
    if (now - this.lastAttemptSweepAt < this.options.windowMs) return;
    this.lastAttemptSweepAt = now;

    for (const [key, attempts] of this.attemptsByKey) {
      if (now - attempts.startedAt >= this.options.windowMs) {
        this.attemptsByKey.delete(key);
      }
    }
  }
}
