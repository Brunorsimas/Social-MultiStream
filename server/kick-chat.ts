import type { Request, Response } from "express";
import WebSocket, { type RawData } from "ws";
import { ConnectionLimiter, resolveClientAddress } from "./security";
import { bindSseLifecycle } from "./sse-lifecycle";

const PUSHER_URL =
  "wss://ws-us3.pusher.com/app/dd11c46dae0376080879?protocol=7&client=js&version=7.6.0&flash=false";
const MAX_CONNECTION_LIFETIME_MS = 6 * 60 * 60 * 1_000;
const MAX_PUSHER_PAYLOAD_BYTES = 256 * 1_024;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_USER_NAME_LENGTH = 80;
const MAX_MESSAGE_ID_LENGTH = 200;
const MAX_AVATAR_URL_LENGTH = 2_048;
const kickConnectionLimiter = new ConnectionLimiter({
  maxActiveTotal: 100,
  maxActivePerKey: 10,
  maxAttemptsTotalPerWindow: 300,
  maxAttemptsPerWindow: 30,
  windowMs: 60_000,
});

function getClientKey(req: Request): string {
  return resolveClientAddress(
    req.socket.remoteAddress,
    req.header("x-forwarded-for"),
  );
}

function boundedString(value: unknown, maxLength: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, maxLength);
}

function safeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_AVATAR_URL_LENGTH) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function rawDataSize(raw: RawData): number {
  if (Array.isArray(raw)) {
    return raw.reduce((total, item) => total + item.byteLength, 0);
  }
  return raw.byteLength;
}

type KickChatroomLookup =
  | { id: number; reason: null }
  | { id: null; reason: "blocked" | "not_found" | "unavailable" };

function getConfiguredKickChatroomId(channel: string): number | null {
  const raw = process.env.KICK_CHATROOM_IDS;
  if (!raw || raw.length > 10_000) return null;

  try {
    const mapping = JSON.parse(raw) as Record<string, unknown>;
    const value = mapping[channel.toLowerCase()];
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? value
      : null;
  } catch {
    return null;
  }
}

async function getKickChatroomId(channel: string): Promise<KickChatroomLookup> {
  const configuredId = getConfiguredKickChatroomId(channel);
  if (configuredId) return { id: configuredId, reason: null };

  const slug = encodeURIComponent(channel);
  const endpoints = [
    `https://kick.com/api/v2/channels/${slug}/chatroom`,
    `https://kick.com/api/v2/channels/${slug}`,
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
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(10_000),
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

      const data = (await response.json()) as {
        id?: number;
        chatroom?: { id?: number };
      };
      const id = data.id ?? data.chatroom?.id;
      if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) {
        console.log(`[kick] Channel "${channel}" -> chatroomId: ${id}`);
        return { id, reason: null };
      }
    } catch {
      // Tenta o endpoint alternativo.
    }
  }

  if (blocked) return { id: null, reason: "blocked" };
  if (notFound) return { id: null, reason: "not_found" };
  return { id: null, reason: "unavailable" };
}

export async function kickChatSSE(req: Request, res: Response): Promise<void> {
  const channelParam = req.params.channel;
  const channel = (
    Array.isArray(channelParam) ? channelParam[0] : (channelParam ?? "")
  )
    .toLowerCase()
    .trim();
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
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let ws: WebSocket | undefined;
  let backpressured = false;
  let maxLifetimeTimer: ReturnType<typeof setTimeout>;

  const handleDrain = () => {
    backpressured = false;
    try {
      ws?.resume();
    } catch {}
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
    } catch {}
  };

  maxLifetimeTimer = setTimeout(() => {
    cleanup();
    if (!res.writableEnded) res.end();
  }, MAX_CONNECTION_LIFETIME_MS);
  (
    maxLifetimeTimer as ReturnType<typeof setTimeout> & {
      unref?: () => void;
    }
  ).unref?.();

  bindSseLifecycle(req, res, () => {
    console.log(`[kick] Client disconnected from SSE for "${channel}"`);
    cleanup();
  });
  res.on("drain", handleDrain);

  const chatroom = await getKickChatroomId(channel);
  if (closed || res.destroyed) return;

  if (!chatroom.id) {
    const message =
      chatroom.reason === "blocked"
        ? "O Kick bloqueou a consulta pública deste servidor. Configure KICK_CHATROOM_IDS ou tente novamente em outra rede."
        : chatroom.reason === "not_found"
          ? `Canal "${channel}" não encontrado no Kick`
          : "Não foi possível consultar o chat do Kick neste momento.";
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
    res.end();
    return;
  }
  const chatroomId = chatroom.id;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (payload: object) => {
    if (closed || res.writableEnded || res.destroyed || backpressured) {
      return false;
    }
    try {
      const accepted = res.write(`data: ${JSON.stringify(payload)}\n\n`);
      if (!accepted) {
        backpressured = true;
        try {
          ws?.pause();
        } catch {}
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
      perMessageDeflate: false,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[kick] WebSocket init failed: ${message}`);
    send({ type: "error", message: "Falha ao conectar ao WebSocket" });
    res.end();
    return;
  }

  ws.on("open", () => {
    if (backpressured) ws.pause();
    console.log(`[kick] Pusher connected, subscribing to chatrooms.${chatroomId}.v2`);
    ws.send(
      JSON.stringify({
        event: "pusher:subscribe",
        data: { auth: "", channel: `chatrooms.${chatroomId}.v2` },
      })
    );
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "pusher:ping", data: {} }));
      }
    }, 25000);
  });

  ws.on("message", (raw) => {
    if (rawDataSize(raw) > MAX_PUSHER_PAYLOAD_BYTES) return;
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.event === "App\\Events\\ChatMessageEvent") {
        const d =
          typeof msg.data === "string" ? JSON.parse(msg.data) : msg.data;
        const content = boundedString(d?.content, MAX_MESSAGE_LENGTH);
        if (!content) return;
        const timestamp = d.created_at
          ? new Date(d.created_at).getTime()
          : Date.now();
        send({
          type: "message",
          messageId:
            boundedString(d.id, MAX_MESSAGE_ID_LENGTH) ||
            `${Date.now()}-${Math.random()}`,
          userName:
            boundedString(d.sender?.username, MAX_USER_NAME_LENGTH) ||
            "Unknown",
          userAvatar: safeAvatarUrl(
            d.sender?.profile_picture ?? d.sender?.profile_pic,
          ),
          message: content,
          timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
        });
      } else if (msg.event === "pusher_internal:subscription_succeeded") {
        console.log(`[kick] Subscribed to chatrooms.${chatroomId}.v2`);
        send({ type: "subscribed", chatroomId });
      } else if (msg.event === "pusher:ping" && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "pusher:pong", data: {} }));
      } else if (msg.event === "pusher:error") {
        console.error(`[kick] Pusher error: ${JSON.stringify(msg.data)}`);
      }
    } catch {}
  });

  ws.on("error", (e) => {
    console.error(`[kick] WebSocket error: ${e.message}`);
    send({ type: "error", message: "Erro no WebSocket do Kick" });
  });

  ws.on("close", (code) => {
    console.log(`[kick] WebSocket closed: ${code}`);
    if (!closed) send({ type: "disconnected" });
    cleanup();
    try { res.end(); } catch {}
  });
}
