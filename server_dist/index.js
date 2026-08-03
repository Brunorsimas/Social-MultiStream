// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";

// server/kick-chat.ts
import WebSocket from "ws";

// server/security.ts
import { isIP } from "node:net";
function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character] ?? character
  );
}
function buildContentSecurityPolicy(nonce) {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'"
  ].join("; ");
}
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
function normalizePublicHost(value) {
  return parsePublicAddress(value)?.host ?? null;
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
function isPrivateOrLoopbackAddress(address) {
  const normalized = address.toLowerCase().trim();
  if (!normalized || normalized === "unknown") return true;
  if (normalized.startsWith("::ffff:")) {
    return isPrivateOrLoopbackAddress(normalized.slice("::ffff:".length));
  }
  if (isIP(normalized) === 4) {
    const octets = normalized.split(".").map(Number);
    return octets[0] === 10 || octets[0] === 127 || octets[0] === 169 && octets[1] === 254 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168 || normalized === "0.0.0.0";
  }
  if (isIP(normalized) === 6) {
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
  }
  return true;
}
function resolveClientAddress(remoteAddress, forwardedFor) {
  const remote = remoteAddress?.trim() || "unknown";
  if (!isPrivateOrLoopbackAddress(remote) || !forwardedFor || forwardedFor.length > 2048) {
    return remote;
  }
  const forwardedAddresses = forwardedFor.split(",").slice(0, 20).map((address) => address.trim()).filter((address) => isIP(address) !== 0);
  for (let index = forwardedAddresses.length - 1; index >= 0; index -= 1) {
    const address = forwardedAddresses[index];
    if (!isPrivateOrLoopbackAddress(address)) return address;
  }
  return forwardedAddresses.at(-1) ?? remote;
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

// server/sse-lifecycle.ts
function bindSseLifecycle(req, res, onDisconnect) {
  let disconnected = false;
  const disconnectOnce = () => {
    if (disconnected) return;
    disconnected = true;
    onDisconnect();
  };
  req.once("aborted", disconnectOnce);
  res.once("close", disconnectOnce);
  res.once("finish", disconnectOnce);
}

// server/kick-chat.ts
var PUSHER_URL = "wss://ws-us3.pusher.com/app/dd11c46dae0376080879?protocol=7&client=js&version=7.6.0&flash=false";
var MAX_CONNECTION_LIFETIME_MS = 6 * 60 * 60 * 1e3;
var MAX_PUSHER_PAYLOAD_BYTES = 256 * 1024;
var MAX_MESSAGE_LENGTH = 4e3;
var MAX_USER_NAME_LENGTH = 80;
var MAX_MESSAGE_ID_LENGTH = 200;
var MAX_AVATAR_URL_LENGTH = 2048;
var kickConnectionLimiter = new ConnectionLimiter({
  maxActiveTotal: 100,
  maxActivePerKey: 10,
  maxAttemptsTotalPerWindow: 300,
  maxAttemptsPerWindow: 30,
  windowMs: 6e4
});
function getClientKey(req) {
  return resolveClientAddress(
    req.socket.remoteAddress,
    req.header("x-forwarded-for")
  );
}
function boundedString(value, maxLength) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, maxLength);
}
function safeAvatarUrl(value) {
  if (typeof value !== "string" || value.length > MAX_AVATAR_URL_LENGTH) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
function rawDataSize(raw) {
  if (Array.isArray(raw)) {
    return raw.reduce((total, item) => total + item.byteLength, 0);
  }
  return raw.byteLength;
}
function getConfiguredKickChatroomId(channel) {
  const raw = process.env.KICK_CHATROOM_IDS;
  if (!raw || raw.length > 1e4) return null;
  try {
    const mapping = JSON.parse(raw);
    const value = mapping[channel.toLowerCase()];
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}
async function getKickChatroomId(channel) {
  const configuredId = getConfiguredKickChatroomId(channel);
  if (configuredId) return { id: configuredId, reason: null };
  const slug = encodeURIComponent(channel);
  const endpoints = [
    `https://kick.com/api/v2/channels/${slug}/chatroom`,
    `https://kick.com/api/v2/channels/${slug}`
  ];
  let blocked = false;
  let notFound = false;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://kick.com/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
        },
        signal: AbortSignal.timeout(1e4)
      });
      if (response.status === 401 || response.status === 403) {
        blocked = true;
        continue;
      }
      if (response.status === 404) {
        notFound = true;
        continue;
      }
      if (!response.ok) continue;
      const data = await response.json();
      const id = data.id ?? data.chatroom?.id;
      if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) {
        console.log(`[kick] Channel "${channel}" -> chatroomId: ${id}`);
        return { id, reason: null };
      }
    } catch {
    }
  }
  if (blocked) return { id: null, reason: "blocked" };
  if (notFound) return { id: null, reason: "not_found" };
  return { id: null, reason: "unavailable" };
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
  let backpressured = false;
  let maxLifetimeTimer;
  const handleDrain = () => {
    backpressured = false;
    try {
      ws?.resume();
    } catch {
    }
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(maxLifetimeTimer);
    if (pingTimer) clearInterval(pingTimer);
    res.off("drain", handleDrain);
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
  bindSseLifecycle(req, res, () => {
    console.log(`[kick] Client disconnected from SSE for "${channel}"`);
    cleanup();
  });
  res.on("drain", handleDrain);
  const chatroom = await getKickChatroomId(channel);
  if (closed || res.destroyed) return;
  if (!chatroom.id) {
    const message = chatroom.reason === "blocked" ? "O Kick bloqueou a consulta p\xFAblica deste servidor. Configure KICK_CHATROOM_IDS ou tente novamente em outra rede." : chatroom.reason === "not_found" ? `Canal "${channel}" n\xE3o encontrado no Kick` : "N\xE3o foi poss\xEDvel consultar o chat do Kick neste momento.";
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        message,
        retryable: chatroom.reason !== "not_found"
      })}

`
    );
    res.end();
    return;
  }
  const chatroomId = chatroom.id;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (payload) => {
    if (closed || res.writableEnded || res.destroyed || backpressured) {
      return false;
    }
    try {
      const accepted = res.write(`data: ${JSON.stringify(payload)}

`);
      if (!accepted) {
        backpressured = true;
        try {
          ws?.pause();
        } catch {
        }
      }
      return accepted;
    } catch {
      return false;
    }
  };
  send({ type: "connected", chatroomId });
  console.log(`[kick] SSE connected for "${channel}" (chatroom ${chatroomId})`);
  try {
    ws = new WebSocket(PUSHER_URL, {
      maxPayload: MAX_PUSHER_PAYLOAD_BYTES,
      perMessageDeflate: false
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[kick] WebSocket init failed: ${message}`);
    send({
      type: "error",
      message: "Falha ao conectar ao WebSocket",
      retryable: true
    });
    res.end();
    return;
  }
  ws.on("open", () => {
    if (backpressured) ws.pause();
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
    if (rawDataSize(raw) > MAX_PUSHER_PAYLOAD_BYTES) return;
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.event === "App\\Events\\ChatMessageEvent") {
        const d = typeof msg.data === "string" ? JSON.parse(msg.data) : msg.data;
        const content = boundedString(d?.content, MAX_MESSAGE_LENGTH);
        if (!content) return;
        const timestamp = d.created_at ? new Date(d.created_at).getTime() : Date.now();
        send({
          type: "message",
          messageId: boundedString(d.id, MAX_MESSAGE_ID_LENGTH) || `${Date.now()}-${Math.random()}`,
          userName: boundedString(d.sender?.username, MAX_USER_NAME_LENGTH) || "Unknown",
          userAvatar: safeAvatarUrl(
            d.sender?.profile_picture ?? d.sender?.profile_pic
          ),
          message: content,
          timestamp: Number.isFinite(timestamp) ? timestamp : Date.now()
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
    send({
      type: "error",
      message: "Erro no WebSocket do Kick",
      retryable: true
    });
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

// server/twitch-chat.ts
import WebSocket2 from "ws";
var TWITCH_IRC_URL = "wss://irc-ws.chat.twitch.tv:443";
var MAX_CONNECTION_LIFETIME_MS2 = 6 * 60 * 60 * 1e3;
var MAX_IRC_PAYLOAD_BYTES = 256 * 1024;
var MAX_MESSAGE_LENGTH2 = 4e3;
var MAX_USER_NAME_LENGTH2 = 80;
var MAX_MESSAGE_ID_LENGTH2 = 200;
var twitchConnectionLimiter = new ConnectionLimiter({
  maxActiveTotal: 100,
  maxActivePerKey: 10,
  maxAttemptsTotalPerWindow: 300,
  maxAttemptsPerWindow: 30,
  windowMs: 6e4
});
function getClientKey2(req) {
  return resolveClientAddress(
    req.socket.remoteAddress,
    req.header("x-forwarded-for")
  );
}
function rawDataSize2(raw) {
  if (Array.isArray(raw)) {
    return raw.reduce((total, item) => total + item.byteLength, 0);
  }
  return raw.byteLength;
}
function decodeIrcTag(value) {
  return value.replace(/\\([sn:r\\])/g, (_, escaped) => {
    if (escaped === "s") return " ";
    if (escaped === "n") return "\n";
    if (escaped === "r") return "\r";
    if (escaped === ":") return ";";
    return "\\";
  });
}
function parseTags(raw) {
  return Object.fromEntries(
    raw.split(";").map((entry) => {
      const separator = entry.indexOf("=");
      return separator === -1 ? [entry, ""] : [
        entry.slice(0, separator),
        decodeIrcTag(entry.slice(separator + 1))
      ];
    })
  );
}
function parseTwitchPrivmsg(line, fallbackTimestamp = Date.now()) {
  if (!line.startsWith("@")) return null;
  const tagEnd = line.indexOf(" ");
  if (tagEnd < 2) return null;
  const marker = " PRIVMSG ";
  const commandStart = line.indexOf(marker, tagEnd);
  if (commandStart === -1) return null;
  const messageStart = line.indexOf(" :", commandStart + marker.length);
  if (messageStart === -1) return null;
  const tags = parseTags(line.slice(1, tagEnd));
  const message = line.slice(messageStart + 2).trim().slice(0, MAX_MESSAGE_LENGTH2);
  if (!message) return null;
  const parsedTimestamp = Number(tags["tmi-sent-ts"]);
  const fallbackUser = line.slice(tagEnd + 1, commandStart).replace(/^:/, "").split("!", 1)[0];
  return {
    messageId: (tags.id || `${fallbackTimestamp}-${Math.random()}`).slice(0, MAX_MESSAGE_ID_LENGTH2),
    userName: (tags["display-name"] || fallbackUser || "Unknown").slice(0, MAX_USER_NAME_LENGTH2),
    userAvatar: null,
    message,
    timestamp: Number.isFinite(parsedTimestamp) && parsedTimestamp > 0 ? parsedTimestamp : fallbackTimestamp
  };
}
function getCredentials() {
  const configuredToken = process.env.TWITCH_OAUTH_TOKEN?.trim();
  const configuredNick = process.env.TWITCH_BOT_USERNAME?.trim().toLowerCase();
  if (configuredToken && configuredNick && /^[a-z\d_]{1,25}$/.test(configuredNick)) {
    return {
      pass: configuredToken.startsWith("oauth:") ? configuredToken : `oauth:${configuredToken}`,
      nick: configuredNick,
      authenticated: true
    };
  }
  return {
    pass: "SCHMOOPIIE",
    nick: `justinfan${Math.floor(1e4 + Math.random() * 89999)}`,
    authenticated: false
  };
}
async function twitchChatSSE(req, res) {
  const channelParam = req.params.channel;
  const channel = (Array.isArray(channelParam) ? channelParam[0] : channelParam ?? "").toLowerCase().trim();
  if (!/^[a-z\d_]{1,25}$/.test(channel)) {
    res.status(400).json({ error: "Invalid Twitch channel" });
    return;
  }
  const lease = twitchConnectionLimiter.tryAcquire(getClientKey2(req));
  if (lease.ok === false) {
    res.setHeader("Retry-After", String(lease.retryAfterSeconds));
    res.status(lease.status).json({ error: lease.reason });
    return;
  }
  let closed = false;
  let ws;
  let heartbeatTimer = null;
  let maxLifetimeTimer;
  let backpressured = false;
  const handleDrain = () => {
    backpressured = false;
    try {
      ws?.resume();
    } catch {
    }
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(maxLifetimeTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    res.off("drain", handleDrain);
    lease.release();
    try {
      ws?.close();
    } catch {
    }
  };
  maxLifetimeTimer = setTimeout(() => {
    cleanup();
    if (!res.writableEnded) res.end();
  }, MAX_CONNECTION_LIFETIME_MS2);
  maxLifetimeTimer.unref?.();
  bindSseLifecycle(req, res, cleanup);
  res.on("drain", handleDrain);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (payload) => {
    if (closed || res.writableEnded || res.destroyed || backpressured) return;
    try {
      if (!res.write(`data: ${JSON.stringify(payload)}

`)) {
        backpressured = true;
        try {
          ws?.pause();
        } catch {
        }
      }
    } catch {
      cleanup();
    }
  };
  const credentials = getCredentials();
  try {
    ws = new WebSocket2(TWITCH_IRC_URL, {
      maxPayload: MAX_IRC_PAYLOAD_BYTES,
      perMessageDeflate: false
    });
  } catch {
    send({ type: "error", message: "Unable to initialize Twitch chat" });
    res.end();
    return;
  }
  ws.on("open", () => {
    if (backpressured) ws?.pause();
    ws?.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
    ws?.send(`PASS ${credentials.pass}`);
    ws?.send(`NICK ${credentials.nick}`);
    ws?.send(`JOIN #${channel}`);
    send({
      type: "connected",
      authenticated: credentials.authenticated
    });
  });
  ws.on("message", (raw) => {
    if (rawDataSize2(raw) > MAX_IRC_PAYLOAD_BYTES) return;
    for (const line of raw.toString().split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith("PING ")) {
        if (ws?.readyState === WebSocket2.OPEN) {
          ws.send(`PONG ${line.slice(5)}`);
        }
        continue;
      }
      if (/Login authentication failed|Improperly formatted auth/i.test(line)) {
        send({
          type: "error",
          message: "Twitch authentication failed. Check TWITCH_BOT_USERNAME and TWITCH_OAUTH_TOKEN."
        });
        continue;
      }
      const message = parseTwitchPrivmsg(line);
      if (message) send({ type: "message", ...message });
    }
  });
  heartbeatTimer = setInterval(() => {
    send({ type: "heartbeat" });
  }, 25e3);
  heartbeatTimer.unref?.();
  ws.on("error", (error) => {
    console.error(`[twitch] WebSocket error for "${channel}": ${error.message}`);
    send({ type: "error", message: "Twitch chat connection failed" });
  });
  ws.on("close", () => {
    if (!closed) send({ type: "disconnected" });
    cleanup();
    try {
      res.end();
    } catch {
    }
  });
}

// server/youtube-chat.ts
var MAX_CONNECTION_LIFETIME_MS3 = 6 * 60 * 60 * 1e3;
var MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
var MAX_MESSAGE_LENGTH3 = 4e3;
var MAX_USER_NAME_LENGTH3 = 80;
var MAX_MESSAGE_ID_LENGTH3 = 200;
var MAX_AVATAR_URL_LENGTH2 = 2048;
var MAX_SEEN_IDS = 5e3;
var DEFAULT_POLL_INTERVAL_MS = 3e3;
var youtubeConnectionLimiter = new ConnectionLimiter({
  maxActiveTotal: 100,
  maxActivePerKey: 10,
  maxAttemptsTotalPerWindow: 300,
  maxAttemptsPerWindow: 30,
  windowMs: 6e4
});
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedText(value, maxLength) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, maxLength) : "";
}
function getClientKey3(req) {
  return resolveClientAddress(
    req.socket.remoteAddress,
    req.header("x-forwarded-for")
  );
}
function safeAvatarUrl2(value) {
  if (typeof value !== "string" || value.length > MAX_AVATAR_URL_LENGTH2) {
    return null;
  }
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
function simpleText(value) {
  if (!isRecord(value)) return "";
  if (typeof value.simpleText === "string") return value.simpleText;
  if (!Array.isArray(value.runs)) return "";
  return value.runs.map((run) => {
    if (!isRecord(run)) return "";
    if (typeof run.text === "string") return run.text;
    if (!isRecord(run.emoji)) return "";
    const shortcuts = run.emoji.shortcuts;
    if (Array.isArray(shortcuts) && typeof shortcuts[0] === "string") {
      return shortcuts[0];
    }
    const accessibility = run.emoji.image;
    if (isRecord(accessibility) && isRecord(accessibility.accessibility) && isRecord(accessibility.accessibility.accessibilityData)) {
      return boundedText(
        accessibility.accessibility.accessibilityData.label,
        100
      );
    }
    return "";
  }).join("");
}
function firstThumbnail(value) {
  if (!isRecord(value) || !Array.isArray(value.thumbnails)) return null;
  for (let index = value.thumbnails.length - 1; index >= 0; index -= 1) {
    const thumbnail = value.thumbnails[index];
    if (isRecord(thumbnail)) {
      const safe = safeAvatarUrl2(thumbnail.url);
      if (safe) return safe;
    }
  }
  return null;
}
function parseRenderer(renderer, fallbackTimestamp = Date.now()) {
  const messageParts = [
    simpleText(renderer.message),
    simpleText(renderer.headerSubtext),
    simpleText(renderer.primaryText),
    simpleText(renderer.purchaseAmountText)
  ].filter(Boolean);
  if (isRecord(renderer.sticker)) {
    const accessibility = renderer.sticker.accessibility;
    if (isRecord(accessibility) && isRecord(accessibility.accessibilityData)) {
      const stickerLabel = boundedText(
        accessibility.accessibilityData.label,
        200
      );
      if (stickerLabel) messageParts.push(stickerLabel);
    }
  }
  const message = Array.from(new Set(messageParts)).join(" \xB7 ").trim().slice(0, MAX_MESSAGE_LENGTH3);
  if (!message) return null;
  const timestampUsec = Number(renderer.timestampUsec);
  const timestamp = Number.isFinite(timestampUsec) && timestampUsec > 0 ? Math.floor(timestampUsec / 1e3) : fallbackTimestamp;
  return {
    messageId: boundedText(renderer.id, MAX_MESSAGE_ID_LENGTH3) || `${timestamp}-${Math.random()}`,
    userName: simpleText(renderer.authorName).slice(0, MAX_USER_NAME_LENGTH3) || "YouTube",
    userAvatar: firstThumbnail(renderer.authorPhoto),
    message,
    timestamp
  };
}
var MESSAGE_RENDERERS = /* @__PURE__ */ new Set([
  "liveChatTextMessageRenderer",
  "liveChatPaidMessageRenderer",
  "liveChatPaidStickerRenderer",
  "liveChatMembershipItemRenderer",
  "liveChatSponsorshipsGiftPurchaseAnnouncementRenderer",
  "liveChatSponsorshipsGiftRedemptionAnnouncementRenderer"
]);
function extractYouTubeMessages(root) {
  const output = [];
  const stack = [root];
  const visited = /* @__PURE__ */ new Set();
  let inspected = 0;
  while (stack.length > 0 && inspected < 5e4) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }
    visited.add(current);
    inspected += 1;
    if (Array.isArray(current)) {
      for (const value of current) stack.push(value);
      continue;
    }
    for (const [key, value] of Object.entries(current)) {
      if (MESSAGE_RENDERERS.has(key) && isRecord(value)) {
        const message = parseRenderer(value);
        if (message) output.push(message);
      } else if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
  return output;
}
function extractYouTubeContinuation(root) {
  const stack = [root];
  const visited = /* @__PURE__ */ new Set();
  let inspected = 0;
  while (stack.length > 0 && inspected < 5e4) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }
    visited.add(current);
    inspected += 1;
    if (Array.isArray(current)) {
      for (const value of current) stack.push(value);
      continue;
    }
    const record = current;
    for (const key of [
      "timedContinuationData",
      "invalidationContinuationData",
      "reloadContinuationData"
    ]) {
      const data = record[key];
      if (isRecord(data) && typeof data.continuation === "string") {
        const rawTimeout = Number(data.timeoutMs);
        return {
          continuation: data.continuation,
          timeoutMs: Number.isFinite(rawTimeout) ? Math.max(1e3, Math.min(1e4, rawTimeout)) : DEFAULT_POLL_INTERVAL_MS
        };
      }
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}
function extractAssignedJson(html, markers) {
  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) continue;
    const start = html.indexOf("{", markerIndex + marker.length);
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < html.length; index += 1) {
      const character = html[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}
async function responseText(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("YouTube response is too large");
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error("YouTube response is too large");
  }
  return text;
}
async function resolveHandle(handle) {
  const response = await fetch(
    `https://www.youtube.com/@${encodeURIComponent(handle)}/live`,
    {
      redirect: "follow",
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(15e3)
    }
  );
  if (!response.ok) return null;
  const finalUrl = new URL(response.url);
  const redirectedId = finalUrl.searchParams.get("v") ?? (/^\/live\/([a-z\d_-]{6,20})$/i.exec(finalUrl.pathname)?.[1] ?? null);
  if (redirectedId && /^[a-z\d_-]{6,20}$/i.test(redirectedId)) {
    return redirectedId;
  }
  const html = await responseText(response);
  const liveMarker = html.indexOf('"isLiveNow":true');
  if (liveMarker !== -1) {
    const nearby = html.slice(
      Math.max(0, liveMarker - 4e3),
      Math.min(html.length, liveMarker + 4e3)
    );
    const externalVideoId = /"externalVideoId":"([a-z\d_-]{6,20})"/i.exec(nearby)?.[1] ?? /"canonicalUrl":"https:\\?\/\\?\/www\.youtube\.com\\?\/watch\?v=([a-z\d_-]{6,20})"/i.exec(
      nearby
    )?.[1];
    if (externalVideoId) return externalVideoId;
    const matches = Array.from(
      nearby.matchAll(/"videoId":"([a-z\d_-]{6,20})"/gi)
    );
    const candidate = matches.at(-1)?.[1];
    if (candidate) return candidate;
  }
  return null;
}
async function bootstrap(videoId) {
  const response = await fetch(
    `https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(videoId)}`,
    {
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(15e3)
    }
  );
  if (!response.ok) {
    throw new Error(`YouTube returned HTTP ${response.status}`);
  }
  const html = await responseText(response);
  const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1];
  const clientVersion = /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1];
  const initialData = extractAssignedJson(html, [
    'window["ytInitialData"] =',
    "var ytInitialData =",
    "ytInitialData ="
  ]);
  const next = extractYouTubeContinuation(initialData);
  if (!apiKey || !clientVersion || !next) {
    throw new Error("Live chat is unavailable or the stream is offline");
  }
  return {
    apiKey,
    clientVersion,
    continuation: next.continuation,
    initialMessages: extractYouTubeMessages(initialData)
  };
}
async function fetchContinuation(bootstrapData, continuation) {
  const response = await fetch(
    `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(bootstrapData.apiKey)}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": bootstrapData.clientVersion
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: bootstrapData.clientVersion,
            hl: "en"
          }
        },
        continuation
      }),
      signal: AbortSignal.timeout(15e3)
    }
  );
  if (!response.ok) {
    throw new Error(`YouTube chat returned HTTP ${response.status}`);
  }
  return JSON.parse(await responseText(response));
}
function delay(ms) {
  return new Promise((resolve3) => {
    const timer = setTimeout(resolve3, ms);
    timer.unref?.();
  });
}
async function streamYouTubeChat(videoId, isClosed, send) {
  const bootstrapData = await bootstrap(videoId);
  const seenIds = /* @__PURE__ */ new Set();
  const emitMessages = (messages) => {
    for (const message of messages) {
      if (seenIds.has(message.messageId)) continue;
      seenIds.add(message.messageId);
      send({ type: "message", ...message });
    }
    if (seenIds.size > MAX_SEEN_IDS) {
      const newest = Array.from(seenIds).slice(-MAX_SEEN_IDS);
      seenIds.clear();
      newest.forEach((id) => seenIds.add(id));
    }
  };
  send({ type: "connected", videoId });
  emitMessages(bootstrapData.initialMessages);
  let continuation = bootstrapData.continuation;
  let pollInterval = DEFAULT_POLL_INTERVAL_MS;
  while (!isClosed()) {
    await delay(pollInterval);
    if (isClosed()) break;
    const payload = await fetchContinuation(bootstrapData, continuation);
    emitMessages(extractYouTubeMessages(payload));
    const next = extractYouTubeContinuation(payload);
    if (!next) {
      send({ type: "disconnected" });
      break;
    }
    continuation = next.continuation;
    pollInterval = next.timeoutMs;
  }
}
async function youtubeChatSSEForTarget(req, res, resolveVideoId) {
  const lease = youtubeConnectionLimiter.tryAcquire(getClientKey3(req));
  if (lease.ok === false) {
    res.setHeader("Retry-After", String(lease.retryAfterSeconds));
    res.status(lease.status).json({ error: lease.reason });
    return;
  }
  let closed = false;
  let backpressured = false;
  let heartbeatTimer = null;
  let maxLifetimeTimer;
  const handleDrain = () => {
    backpressured = false;
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(maxLifetimeTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    res.off("drain", handleDrain);
    lease.release();
  };
  maxLifetimeTimer = setTimeout(() => {
    cleanup();
    if (!res.writableEnded) res.end();
  }, MAX_CONNECTION_LIFETIME_MS3);
  maxLifetimeTimer.unref?.();
  bindSseLifecycle(req, res, cleanup);
  res.on("drain", handleDrain);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (payload) => {
    if (closed || res.writableEnded || res.destroyed || backpressured) return;
    try {
      if (!res.write(`data: ${JSON.stringify(payload)}

`)) {
        backpressured = true;
      }
    } catch {
      cleanup();
    }
  };
  heartbeatTimer = setInterval(() => send({ type: "heartbeat" }), 25e3);
  heartbeatTimer.unref?.();
  try {
    const videoId = await resolveVideoId();
    if (!videoId || closed) {
      if (!closed) {
        send({
          type: "error",
          message: "No active YouTube live stream was found"
        });
        res.end();
      }
      return;
    }
    await streamYouTubeChat(videoId, () => closed, send);
    if (!closed) res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({ type: "error", message });
    if (!res.writableEnded) res.end();
  }
}
async function youtubeVideoChatSSE(req, res) {
  const videoIdParam = req.params.videoId;
  const videoId = Array.isArray(videoIdParam) ? videoIdParam[0] : videoIdParam ?? "";
  if (!/^[a-z\d_-]{6,20}$/i.test(videoId)) {
    res.status(400).json({ error: "Invalid YouTube video id" });
    return;
  }
  await youtubeChatSSEForTarget(req, res, async () => videoId);
}
async function youtubeHandleChatSSE(req, res) {
  const handleParam = req.params.handle;
  const handle = Array.isArray(handleParam) ? handleParam[0] : handleParam ?? "";
  if (!/^[a-z\d_.-]{1,40}$/i.test(handle)) {
    res.status(400).json({ error: "Invalid YouTube handle" });
    return;
  }
  await youtubeChatSSEForTarget(req, res, () => resolveHandle(handle));
}

// server/routes.ts
async function registerRoutes(app2) {
  app2.get("/api/kick/chat/:channel", kickChatSSE);
  app2.get("/api/twitch/chat/:channel", twitchChatSSE);
  app2.get("/api/youtube/chat/video/:videoId", youtubeVideoChatSSE);
  app2.get("/api/youtube/chat/handle/:handle", youtubeHandleChatSSE);
  const httpServer = createServer(app2);
  return httpServer;
}

// server/expo-deployment.ts
import * as fs from "node:fs";
import * as path from "node:path";
var EXPO_PUBLIC_ORIGIN_PLACEHOLDER = "https://expo-public-origin.invalid";
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function firstValidDomain(values) {
  for (const value of values) {
    if (normalizePublicHost(value)) return value.trim();
  }
  return null;
}
function selectExpoPublicDomain(environment = process.env) {
  const publicDomains = environment.REPLIT_DOMAINS?.split(",").map(
    (domain) => domain.trim()
  );
  const published = environment.REPLIT_DEPLOYMENT === "1" || environment.NODE_ENV === "production";
  return firstValidDomain([
    environment.EXPO_PUBLIC_DOMAIN,
    ...publicDomains ?? [],
    ...published ? [] : [
      environment.REPLIT_DEV_DOMAIN,
      environment.REPLIT_INTERNAL_APP_DOMAIN
    ]
  ]);
}
function resolveExpoPublicOrigin(environment, requestHost, requestProtocol) {
  const configuredDomain = selectExpoPublicDomain(environment);
  const published = environment.REPLIT_DEPLOYMENT === "1" || environment.NODE_ENV === "production";
  if (published && !configuredDomain) return null;
  return resolvePublicOrigin(
    configuredDomain,
    requestHost,
    requestProtocol
  );
}
function rebaseUrl(value, origin) {
  if (typeof value !== "string") {
    throw new Error("Expo manifest contains a non-string asset URL");
  }
  let url;
  try {
    url = new URL(value, EXPO_PUBLIC_ORIGIN_PLACEHOLDER);
  } catch {
    throw new Error("Expo manifest contains an invalid asset URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Expo manifest contains an unsupported asset URL");
  }
  return `${origin}${url.pathname}${url.search}${url.hash}`;
}
function isLocalOrPlaceholderHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === new URL(EXPO_PUBLIC_ORIGIN_PLACEHOLDER).hostname;
}
function normalizePublishedAssetPath(pathname) {
  if (pathname.startsWith("/assets/assets/")) {
    return pathname.slice("/assets".length);
  }
  return pathname;
}
function rewriteLocalManifestUrls(value, publicOrigin) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (typeof item === "string") {
        value[index] = rewriteLocalManifestUrl(item, publicOrigin);
      } else {
        rewriteLocalManifestUrls(item, publicOrigin);
      }
    }
    return;
  }
  if (!isObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      value[key] = rewriteLocalManifestUrl(item, publicOrigin);
    } else {
      rewriteLocalManifestUrls(item, publicOrigin);
    }
  }
}
function rewriteLocalManifestUrl(value, publicOrigin) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" || !isLocalOrPlaceholderHost(url.hostname)) {
    return value;
  }
  const pathname = normalizePublishedAssetPath(url.pathname);
  return `${publicOrigin.origin}${pathname}${url.search}${url.hash}`;
}
function prepareExpoManifest(input, platform, publicOrigin) {
  if (!isObject(input)) {
    throw new Error(`Malformed Expo manifest for ${platform}`);
  }
  const manifest = structuredClone(input);
  rewriteLocalManifestUrls(manifest, publicOrigin);
  if (!isObject(manifest.launchAsset)) {
    throw new Error(`Expo manifest has no launch asset for ${platform}`);
  }
  const launchUrl = rebaseUrl(manifest.launchAsset.url, publicOrigin.origin);
  const launchPath = new URL(launchUrl).pathname;
  const expectedSuffix = `/_expo/static/js/${platform}/bundle.js`;
  if (!launchPath.endsWith(expectedSuffix)) {
    throw new Error(`Expo launch asset does not match ${platform}`);
  }
  manifest.launchAsset.url = launchUrl;
  manifest.launchAsset.contentType = "application/javascript";
  if (Array.isArray(manifest.assets)) {
    for (const asset of manifest.assets) {
      if (!isObject(asset) || typeof asset.url !== "string") continue;
      const parsedAssetUrl = new URL(
        asset.url,
        EXPO_PUBLIC_ORIGIN_PLACEHOLDER
      );
      if (parsedAssetUrl.host === new URL(EXPO_PUBLIC_ORIGIN_PLACEHOLDER).host || parsedAssetUrl.pathname.includes("/_expo/static/js/")) {
        asset.url = rebaseUrl(asset.url, publicOrigin.origin);
      }
    }
  }
  if (!isObject(manifest.extra)) manifest.extra = {};
  const extra = manifest.extra;
  if (!isObject(extra.expoClient)) extra.expoClient = {};
  const expoClient = extra.expoClient;
  expoClient.hostUri = publicOrigin.host;
  delete expoClient._internal;
  if (!isObject(extra.expoGo)) extra.expoGo = {};
  const expoGo = extra.expoGo;
  expoGo.debuggerHost = publicOrigin.host;
  if (isObject(expoGo.developer)) {
    delete expoGo.developer.projectRoot;
  }
  if (!isObject(expoGo.packagerOpts)) {
    expoGo.packagerOpts = {};
  }
  expoGo.packagerOpts.dev = false;
  return manifest;
}
function injectExpoPublicOrigin(bundle, publicOrigin) {
  if (!bundle.includes(EXPO_PUBLIC_ORIGIN_PLACEHOLDER)) {
    throw new Error("Expo bundle has no public-origin placeholder");
  }
  return bundle.replaceAll(
    EXPO_PUBLIC_ORIGIN_PLACEHOLDER,
    publicOrigin.origin
  );
}
function validateExpoBuild(buildRoot) {
  for (const platform of ["ios", "android"]) {
    const manifestPath = path.join(buildRoot, platform, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Missing Expo manifest for ${platform}`);
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
      throw new Error(`Invalid Expo manifest JSON for ${platform}`);
    }
    if (!isObject(manifest) || !isObject(manifest.launchAsset)) {
      throw new Error(`Malformed Expo manifest for ${platform}`);
    }
    const launchAssetUrl = manifest.launchAsset.url;
    if (typeof launchAssetUrl !== "string") {
      throw new Error(`Missing Expo launch asset URL for ${platform}`);
    }
    const launchPath = new URL(
      launchAssetUrl,
      EXPO_PUBLIC_ORIGIN_PLACEHOLDER
    ).pathname;
    const relativeLaunchPath = launchPath.replace(/^\/+/, "");
    const bundlePath = path.resolve(buildRoot, relativeLaunchPath);
    const relativeToRoot = path.relative(buildRoot, bundlePath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot) || !fs.existsSync(bundlePath) || fs.statSync(bundlePath).size === 0) {
      throw new Error(`Missing Expo launch bundle for ${platform}`);
    }
    const bundle = fs.readFileSync(bundlePath, "utf-8");
    if (!bundle.includes(EXPO_PUBLIC_ORIGIN_PLACEHOLDER)) {
      throw new Error(
        `Expo launch bundle has no public-origin placeholder for ${platform}`
      );
    }
  }
}

// server/index.ts
import * as fs2 from "fs";
import * as path2 from "path";
import { randomBytes } from "node:crypto";
import { createProxyMiddleware } from "http-proxy-middleware";
var app = express();
var log = console.log;
var expoBundleCache = /* @__PURE__ */ new Map();
app.disable("x-powered-by");
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    const addConfiguredOrigin = (value) => {
      if (!normalizePublicHost(value)) return;
      origins.add(resolvePublicOrigin(value).origin);
    };
    addConfiguredOrigin(process.env.REPLIT_INTERNAL_APP_DOMAIN);
    addConfiguredOrigin(process.env.REPLIT_DEV_DOMAIN);
    addConfiguredOrigin(process.env.EXPO_PUBLIC_DOMAIN);
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        addConfiguredOrigin(d);
      });
    }
    const origin = req.header("origin");
    let isLocalhost = false;
    if (origin) {
      try {
        const parsedOrigin = new URL(origin);
        isLocalhost = (parsedOrigin.protocol === "http:" || parsedOrigin.protocol === "https:") && (parsedOrigin.hostname === "localhost" || parsedOrigin.hostname === "127.0.0.1" || parsedOrigin.hostname === "::1") && parsedOrigin.origin === origin;
      } catch {
      }
    }
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.vary("Origin");
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupSecurityHeaders(app2) {
  app2.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()"
    );
    if (process.env.NODE_ENV === "production") {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      limit: "100kb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false, limit: "100kb" }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path3 = req.path;
    res.on("finish", () => {
      if (!path3.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
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
    const appJsonPath = path2.resolve(process.cwd(), "app.json");
    const appJsonContent = fs2.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function getRequestPublicOrigin(req) {
  return resolveExpoPublicOrigin(
    process.env,
    req.get("host"),
    req.protocol
  );
}
function serveExpoManifest(platform, req, res) {
  const manifestPath = path2.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs2.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  const publicOrigin = getRequestPublicOrigin(req);
  if (!publicOrigin) {
    return res.status(503).json({ error: "Public deployment domain unavailable" });
  }
  const manifest = prepareExpoManifest(
    JSON.parse(fs2.readFileSync(manifestPath, "utf-8")),
    platform,
    publicOrigin
  );
  res.setHeader("expo-protocol-version", "0");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "private, max-age=0");
  res.status(200).send(JSON.stringify(manifest));
}
function serveExpoBundle(req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const match = req.path.match(
    /^\/(\d+-\d+)\/_expo\/static\/js\/(ios|android)\/bundle\.js$/
  );
  if (!match) return next();
  const bundlePath = path2.resolve(
    process.cwd(),
    "static-build",
    match[1],
    "_expo",
    "static",
    "js",
    match[2],
    "bundle.js"
  );
  if (!fs2.existsSync(bundlePath)) return next();
  const publicOrigin = getRequestPublicOrigin(req);
  if (!publicOrigin) {
    return res.status(503).json({ error: "Public deployment domain unavailable" });
  }
  const cacheKey = `${bundlePath}\0${publicOrigin.origin}`;
  const mtimeMs = fs2.statSync(bundlePath).mtimeMs;
  let cachedBundle = expoBundleCache.get(cacheKey);
  if (!cachedBundle || cachedBundle.mtimeMs !== mtimeMs) {
    cachedBundle = {
      mtimeMs,
      content: Buffer.from(
        injectExpoPublicOrigin(
          fs2.readFileSync(bundlePath, "utf-8"),
          publicOrigin
        )
      )
    };
    expoBundleCache.delete(cacheKey);
    expoBundleCache.set(cacheKey, cachedBundle);
    while (expoBundleCache.size > 4) {
      const oldestKey = expoBundleCache.keys().next().value;
      if (typeof oldestKey !== "string") break;
      expoBundleCache.delete(oldestKey);
    }
  }
  res.setHeader(
    "content-type",
    "application/javascript; charset=utf-8"
  );
  res.setHeader("cache-control", "private, max-age=0");
  res.setHeader("content-length", cachedBundle.content.length);
  res.status(200).send(cachedBundle.content);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const configuredDomain = selectExpoPublicDomain(process.env);
  if (process.env.NODE_ENV === "production" && !normalizePublicHost(configuredDomain)) {
    res.status(503).type("text/plain").send("Service unavailable");
    return;
  }
  const { host, origin: baseUrl } = resolvePublicOrigin(
    configuredDomain,
    req.get("host"),
    req.protocol
  );
  const expsUrl = host;
  const cspNonce = randomBytes(18).toString("base64");
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, escapeHtml(appName)).replace(/CSP_NONCE_PLACEHOLDER/g, cspNonce);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    buildContentSecurityPolicy(cspNonce)
  );
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const buildRoot = path2.resolve(process.cwd(), "static-build");
  validateExpoBuild(buildRoot);
  const templatePath = path2.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs2.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest" && req.path !== "/index.exp") {
      return next();
    }
    const platform = req.header("expo-platform") ?? (typeof req.query.platform === "string" ? req.query.platform : void 0);
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, req, res);
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
  app2.use(serveExpoBundle);
  app2.use("/assets", express.static(path2.resolve(process.cwd(), "assets")));
  app2.use(express.static(buildRoot));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function configureDevelopmentMetroProxy(app2) {
  const metroPort = Number.parseInt(
    process.env.EXPO_METRO_PORT || "8081",
    10
  );
  if (!Number.isInteger(metroPort) || metroPort < 1 || metroPort > 65535) {
    throw new Error("EXPO_METRO_PORT must be a valid TCP port");
  }
  const metroProxy = createProxyMiddleware({
    target: `http://127.0.0.1:${metroPort}`,
    ws: true,
    changeOrigin: false,
    // xfwd must be false: Replit's infrastructure already sets X-Forwarded-Host.
    // Setting xfwd:true would append a second value ("host1, host2") which makes
    // Metro's `new URL(req.url, "https://host1, host2")` throw TypeError: Invalid URL.
    // That 500 causes Expo Go to abort asset loading → "Your app is starting" loop.
    xfwd: false,
    // At "/" we only proxy if the request is from Expo Go (has expo-platform header).
    // Browser requests to "/" skip the proxy so the landing page with QR code is shown.
    // "/api" and "/healthz" are always handled by the Express app itself.
    pathFilter: (pathname, req) => {
      if (!pathname.startsWith("/api") && pathname !== "/healthz") {
        if (pathname === "/") {
          const platform = req.headers?.["expo-platform"];
          return platform === "ios" || platform === "android";
        }
        return true;
      }
      return false;
    }
  });
  app2.use(metroProxy);
  return metroProxy;
}
function configureDevelopmentLandingPage(app2) {
  const templatePath = path2.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  if (!fs2.existsSync(templatePath)) return;
  const landingPageTemplate = fs2.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  app2.get("/", (req, res) => {
    serveLandingPage({ req, res, landingPageTemplate, appName });
  });
}
function setupErrorHandler(app2) {
  app2.use((err, req, res, next) => {
    const error = err;
    const candidateStatus = error.status || error.statusCode;
    const status = Number.isInteger(candidateStatus) && Number(candidateStatus) >= 400 && Number(candidateStatus) <= 599 ? Number(candidateStatus) : 500;
    const message = status >= 500 ? "Internal Server Error" : error.message || "Request failed";
    if (status >= 500) {
      const diagnostic = err instanceof Error ? `${err.name}: ${err.message}` : "Unknown error";
      console.error(
        `${req.method} ${req.path} failed: ${diagnostic.replace(/[\r\n]/g, " ").slice(0, 500)}`
      );
    }
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
async function startServer() {
  setupSecurityHeaders(app);
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  app.get("/healthz", (_req, res) => {
    res.status(200).json({
      status: "ok",
      expo: process.env.NODE_ENV === "production" ? "static" : "metro-proxy"
    });
  });
  const metroProxy = process.env.NODE_ENV === "production" ? null : configureDevelopmentMetroProxy(app);
  if (process.env.NODE_ENV === "production") {
    configureExpoAndLanding(app);
  } else {
    configureDevelopmentLandingPage(app);
  }
  const server = await registerRoutes(app);
  if (metroProxy) {
    server.on("upgrade", metroProxy.upgrade);
  }
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      ...process.platform === "win32" ? {} : { reusePort: true }
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );
  return server;
}
var serverPromise = startServer();
export {
  serverPromise
};
