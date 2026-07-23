// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";

// server/kick-chat.ts
import { isIP } from "node:net";
import WebSocket from "ws";

// server/security.ts
function parsePublicAddress(value) {
  const input = value?.trim();
  if (!input) return null;
  try {
    const address = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
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
      protocol: url.protocol === "http:" ? "http" : "https"
    };
  } catch {
    return null;
  }
}
function resolvePublicOrigin(configuredDomain, requestHost, requestProtocol) {
  const configured = parsePublicAddress(configuredDomain);
  const request = parsePublicAddress(requestHost);
  const host = configured?.host ?? request?.host ?? "localhost:5000";
  const isLocalhost = host === "localhost" || host.startsWith("localhost:") || host === "127.0.0.1" || host.startsWith("127.0.0.1:") || host === "[::1]" || host.startsWith("[::1]:");
  const safeRequestProtocol = requestProtocol === "http" || requestProtocol === "https" ? requestProtocol : null;
  const protocol = configured?.protocol ?? safeRequestProtocol ?? (isLocalhost ? "http" : "https");
  return {
    host,
    protocol,
    origin: `${protocol}://${host}`
  };
}
var ConnectionLimiter = class {
  activeTotal = 0;
  activeByKey = /* @__PURE__ */ new Map();
  attemptsByKey = /* @__PURE__ */ new Map();
  totalAttempts = { count: 0, startedAt: 0 };
  lastAttemptSweepAt = 0;
  options;
  constructor(options) {
    if (options.maxActiveTotal < 1 || options.maxActivePerKey < 1 || options.maxAttemptsTotalPerWindow < 1 || options.maxAttemptsPerWindow < 1 || options.windowMs < 1) {
      throw new Error("Connection limits must be positive");
    }
    this.options = options;
  }
  tryAcquire(rawKey, now = Date.now()) {
    const key = rawKey.trim() || "unknown";
    this.pruneExpiredAttempts(now);
    if (now - this.totalAttempts.startedAt >= this.options.windowMs) {
      this.totalAttempts = { count: 0, startedAt: now };
    }
    if (this.totalAttempts.count >= this.options.maxAttemptsTotalPerWindow) {
      return {
        ok: false,
        status: 429,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (this.options.windowMs - (now - this.totalAttempts.startedAt)) / 1e3
          )
        ),
        reason: "SSE connection attempt capacity reached"
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
            (this.options.windowMs - (now - attempts.startedAt)) / 1e3
          )
        ),
        reason: "Too many connection attempts"
      };
    }
    attempts.count += 1;
    if (this.activeTotal >= this.options.maxActiveTotal) {
      return {
        ok: false,
        status: 503,
        retryAfterSeconds: 5,
        reason: "SSE connection capacity reached"
      };
    }
    const activeForKey = this.activeByKey.get(key) ?? 0;
    if (activeForKey >= this.options.maxActivePerKey) {
      return {
        ok: false,
        status: 429,
        retryAfterSeconds: 5,
        reason: "Too many active SSE connections"
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
      }
    };
  }
  pruneExpiredAttempts(now) {
    if (now - this.lastAttemptSweepAt < this.options.windowMs) return;
    this.lastAttemptSweepAt = now;
    for (const [key, attempts] of this.attemptsByKey) {
      if (now - attempts.startedAt >= this.options.windowMs) {
        this.attemptsByKey.delete(key);
      }
    }
  }
};

// server/kick-chat.ts
var PUSHER_URL = "wss://ws-us3.pusher.com/app/dd11c46dae0376080879?protocol=7&client=js&version=7.6.0&flash=false";
var MAX_CONNECTION_LIFETIME_MS = 6 * 60 * 60 * 1e3;
var kickConnectionLimiter = new ConnectionLimiter({
  maxActiveTotal: 100,
  maxActivePerKey: 10,
  maxAttemptsTotalPerWindow: 300,
  maxAttemptsPerWindow: 30,
  windowMs: 6e4
});
function isPrivateOrLoopback(address) {
  const normalized = address.toLowerCase();
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
  return normalized === "::1" || ipv4.startsWith("127.") || ipv4.startsWith("10.") || ipv4.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(ipv4) || normalized.startsWith("fc") || normalized.startsWith("fd");
}
function getClientKey(req) {
  const remoteAddress = req.socket.remoteAddress ?? "unknown";
  if (isPrivateOrLoopback(remoteAddress)) {
    const forwardedAddress = req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwardedAddress && isIP(forwardedAddress)) {
      return forwardedAddress;
    }
  }
  return remoteAddress;
}
async function getKickChatroomId(channel) {
  try {
    const response = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://kick.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
      },
      signal: AbortSignal.timeout(1e4)
    });
    if (!response.ok) throw new Error(`Kick API returned HTTP ${response.status}`);
    const data = await response.json();
    const id = data?.chatroom?.id;
    console.log(`[kick] Channel "${channel}" -> chatroomId: ${id}`);
    return id ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[kick] Failed to get chatroom id for "${channel}": ${message}`);
    return null;
  }
}
async function kickChatSSE(req, res) {
  const channelParam = req.params.channel;
  const channel = (Array.isArray(channelParam) ? channelParam[0] : channelParam ?? "").toLowerCase().trim();
  if (!channel) {
    res.status(400).json({ error: "Missing channel name" });
    return;
  }
  if (!/^[a-z\d_]{1,40}$/.test(channel)) {
    res.status(400).json({ error: "Invalid channel name" });
    return;
  }
  const lease = kickConnectionLimiter.tryAcquire(getClientKey(req));
  if (lease.ok === false) {
    res.setHeader("Retry-After", String(lease.retryAfterSeconds));
    res.status(lease.status).json({ error: lease.reason });
    return;
  }
  let closed = false;
  let pingTimer = null;
  let ws;
  let maxLifetimeTimer;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(maxLifetimeTimer);
    if (pingTimer) clearInterval(pingTimer);
    lease.release();
    try {
      ws?.close();
    } catch {
    }
  };
  maxLifetimeTimer = setTimeout(() => {
    cleanup();
    if (!res.writableEnded) res.end();
  }, MAX_CONNECTION_LIFETIME_MS);
  maxLifetimeTimer.unref?.();
  req.once("close", () => {
    console.log(`[kick] Client disconnected from SSE for "${channel}"`);
    cleanup();
  });
  res.once("close", cleanup);
  res.once("finish", cleanup);
  const chatroomId = await getKickChatroomId(channel);
  if (closed || res.destroyed) return;
  if (!chatroomId) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`data: ${JSON.stringify({ type: "error", message: `Canal "${channel}" n\xE3o encontrado no Kick` })}

`);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (payload) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}

`);
    } catch {
    }
  };
  send({ type: "connected", chatroomId });
  console.log(`[kick] SSE connected for "${channel}" (chatroom ${chatroomId})`);
  try {
    ws = new WebSocket(PUSHER_URL);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[kick] WebSocket init failed: ${message}`);
    send({ type: "error", message: "Falha ao conectar ao WebSocket" });
    res.end();
    return;
  }
  ws.on("open", () => {
    console.log(`[kick] Pusher connected, subscribing to chatrooms.${chatroomId}.v2`);
    ws.send(
      JSON.stringify({
        event: "pusher:subscribe",
        data: { auth: "", channel: `chatrooms.${chatroomId}.v2` }
      })
    );
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "pusher:ping", data: {} }));
      }
    }, 25e3);
  });
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.event === "App\\Events\\ChatMessageEvent") {
        const d = typeof msg.data === "string" ? JSON.parse(msg.data) : msg.data;
        const content = String(d.content ?? "").trim();
        if (!content) return;
        send({
          type: "message",
          messageId: d.id ?? `${Date.now()}-${Math.random()}`,
          userName: d.sender?.username ?? "Unknown",
          userAvatar: d.sender?.profile_picture ?? d.sender?.profile_pic ?? null,
          message: content,
          timestamp: d.created_at ? new Date(d.created_at).getTime() : Date.now()
        });
      } else if (msg.event === "pusher_internal:subscription_succeeded") {
        console.log(`[kick] Subscribed to chatrooms.${chatroomId}.v2`);
        send({ type: "subscribed", chatroomId });
      } else if (msg.event === "pusher:ping" && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "pusher:pong", data: {} }));
      } else if (msg.event === "pusher:error") {
        console.error(`[kick] Pusher error: ${JSON.stringify(msg.data)}`);
      }
    } catch {
    }
  });
  ws.on("error", (e) => {
    console.error(`[kick] WebSocket error: ${e.message}`);
    send({ type: "error", message: "Erro no WebSocket do Kick" });
  });
  ws.on("close", (code) => {
    console.log(`[kick] WebSocket closed: ${code}`);
    if (!closed) send({ type: "disconnected" });
    cleanup();
    try {
      res.end();
    } catch {
    }
  });
}

// server/routes.ts
async function registerRoutes(app2) {
  app2.get("/api/kick/chat/:channel", kickChatSSE);
  const httpServer = createServer(app2);
  return httpServer;
}

// server/index.ts
import * as fs from "fs";
import * as path from "path";
var app = express();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path2 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path2.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path2} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const configuredDomain = process.env.REPLIT_INTERNAL_APP_DOMAIN ?? process.env.REPLIT_DEV_DOMAIN ?? process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.EXPO_PUBLIC_DOMAIN;
  const { host, origin: baseUrl } = resolvePublicOrigin(
    configuredDomain,
    req.get("host"),
    req.protocol
  );
  const expsUrl = host;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    next();
  });
  app2.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app2.use(express.static(path.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );
})();
