import type { Request, Response } from "express";
import WebSocket, { type RawData } from "ws";
import { ConnectionLimiter, resolveClientAddress } from "./security.ts";
import { bindSseLifecycle } from "./sse-lifecycle.ts";

const TWITCH_IRC_URL = "wss://irc-ws.chat.twitch.tv:443";
const MAX_CONNECTION_LIFETIME_MS = 6 * 60 * 60 * 1_000;
const MAX_IRC_PAYLOAD_BYTES = 256 * 1_024;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_USER_NAME_LENGTH = 80;
const MAX_MESSAGE_ID_LENGTH = 200;
const twitchConnectionLimiter = new ConnectionLimiter({
  maxActiveTotal: 100,
  maxActivePerKey: 10,
  maxAttemptsTotalPerWindow: 300,
  maxAttemptsPerWindow: 30,
  windowMs: 60_000,
});

type TwitchChatMessage = {
  messageId: string;
  userName: string;
  userAvatar: null;
  message: string;
  timestamp: number;
};

function getClientKey(req: Request): string {
  return resolveClientAddress(
    req.socket.remoteAddress,
    req.header("x-forwarded-for"),
  );
}

function rawDataSize(raw: RawData): number {
  if (Array.isArray(raw)) {
    return raw.reduce((total, item) => total + item.byteLength, 0);
  }
  return raw.byteLength;
}

function decodeIrcTag(value: string): string {
  return value.replace(/\\([sn:r\\])/g, (_, escaped: string) => {
    if (escaped === "s") return " ";
    if (escaped === "n") return "\n";
    if (escaped === "r") return "\r";
    if (escaped === ":") return ";";
    return "\\";
  });
}

function parseTags(raw: string): Record<string, string> {
  return Object.fromEntries(
    raw.split(";").map((entry) => {
      const separator = entry.indexOf("=");
      return separator === -1
        ? [entry, ""]
        : [
            entry.slice(0, separator),
            decodeIrcTag(entry.slice(separator + 1)),
          ];
    }),
  );
}

export function parseTwitchPrivmsg(
  line: string,
  fallbackTimestamp = Date.now(),
): TwitchChatMessage | null {
  if (!line.startsWith("@")) return null;
  const tagEnd = line.indexOf(" ");
  if (tagEnd < 2) return null;

  const marker = " PRIVMSG ";
  const commandStart = line.indexOf(marker, tagEnd);
  if (commandStart === -1) return null;
  const messageStart = line.indexOf(" :", commandStart + marker.length);
  if (messageStart === -1) return null;

  const tags = parseTags(line.slice(1, tagEnd));
  const message = line.slice(messageStart + 2).trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!message) return null;

  const parsedTimestamp = Number(tags["tmi-sent-ts"]);
  const fallbackUser = line
    .slice(tagEnd + 1, commandStart)
    .replace(/^:/, "")
    .split("!", 1)[0];

  return {
    messageId:
      (tags.id || `${fallbackTimestamp}-${Math.random()}`)
        .slice(0, MAX_MESSAGE_ID_LENGTH),
    userName:
      (tags["display-name"] || fallbackUser || "Unknown")
        .slice(0, MAX_USER_NAME_LENGTH),
    userAvatar: null,
    message,
    timestamp:
      Number.isFinite(parsedTimestamp) && parsedTimestamp > 0
        ? parsedTimestamp
        : fallbackTimestamp,
  };
}

function getCredentials(): {
  pass: string;
  nick: string;
  authenticated: boolean;
} {
  const configuredToken = process.env.TWITCH_OAUTH_TOKEN?.trim();
  const configuredNick = process.env.TWITCH_BOT_USERNAME
    ?.trim()
    .toLowerCase();
  if (
    configuredToken &&
    configuredNick &&
    /^[a-z\d_]{1,25}$/.test(configuredNick)
  ) {
    return {
      pass: configuredToken.startsWith("oauth:")
        ? configuredToken
        : `oauth:${configuredToken}`,
      nick: configuredNick,
      authenticated: true,
    };
  }

  return {
    pass: "SCHMOOPIIE",
    nick: `justinfan${Math.floor(10_000 + Math.random() * 89_999)}`,
    authenticated: false,
  };
}

export async function twitchChatSSE(
  req: Request,
  res: Response,
): Promise<void> {
  const channelParam = req.params.channel;
  const channel = (
    Array.isArray(channelParam) ? channelParam[0] : (channelParam ?? "")
  )
    .toLowerCase()
    .trim();
  if (!/^[a-z\d_]{1,25}$/.test(channel)) {
    res.status(400).json({ error: "Invalid Twitch channel" });
    return;
  }

  const lease = twitchConnectionLimiter.tryAcquire(getClientKey(req));
  if (lease.ok === false) {
    res.setHeader("Retry-After", String(lease.retryAfterSeconds));
    res.status(lease.status).json({ error: lease.reason });
    return;
  }

  let closed = false;
  let ws: WebSocket | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let maxLifetimeTimer: ReturnType<typeof setTimeout>;
  let backpressured = false;

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
    if (heartbeatTimer) clearInterval(heartbeatTimer);
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

  bindSseLifecycle(req, res, cleanup);
  res.on("drain", handleDrain);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (payload: object) => {
    if (closed || res.writableEnded || res.destroyed || backpressured) return;
    try {
      if (!res.write(`data: ${JSON.stringify(payload)}\n\n`)) {
        backpressured = true;
        try {
          ws?.pause();
        } catch {}
      }
    } catch {
      cleanup();
    }
  };

  const credentials = getCredentials();
  try {
    ws = new WebSocket(TWITCH_IRC_URL, {
      maxPayload: MAX_IRC_PAYLOAD_BYTES,
      perMessageDeflate: false,
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
      authenticated: credentials.authenticated,
    });
  });

  ws.on("message", (raw) => {
    if (rawDataSize(raw) > MAX_IRC_PAYLOAD_BYTES) return;
    for (const line of raw.toString().split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith("PING ")) {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(`PONG ${line.slice(5)}`);
        }
        continue;
      }
      if (
        /Login authentication failed|Improperly formatted auth/i.test(line)
      ) {
        send({
          type: "error",
          message:
            "Twitch authentication failed. Check TWITCH_BOT_USERNAME and TWITCH_OAUTH_TOKEN.",
        });
        continue;
      }

      const message = parseTwitchPrivmsg(line);
      if (message) send({ type: "message", ...message });
    }
  });

  heartbeatTimer = setInterval(() => {
    send({ type: "heartbeat" });
  }, 25_000);
  (
    heartbeatTimer as ReturnType<typeof setInterval> & {
      unref?: () => void;
    }
  ).unref?.();

  ws.on("error", (error) => {
    console.error(`[twitch] WebSocket error for "${channel}": ${error.message}`);
    send({ type: "error", message: "Twitch chat connection failed" });
  });
  ws.on("close", () => {
    if (!closed) send({ type: "disconnected" });
    cleanup();
    try {
      res.end();
    } catch {}
  });
}
