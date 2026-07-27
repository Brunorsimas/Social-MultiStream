import type { Request, Response as ExpressResponse } from "express";
import { ConnectionLimiter, resolveClientAddress } from "./security.ts";
import { bindSseLifecycle } from "./sse-lifecycle.ts";

const MAX_CONNECTION_LIFETIME_MS = 6 * 60 * 60 * 1_000;
const MAX_RESPONSE_BYTES = 5 * 1_024 * 1_024;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_USER_NAME_LENGTH = 80;
const MAX_MESSAGE_ID_LENGTH = 200;
const MAX_AVATAR_URL_LENGTH = 2_048;
const MAX_SEEN_IDS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const youtubeConnectionLimiter = new ConnectionLimiter({
  maxActiveTotal: 100,
  maxActivePerKey: 10,
  maxAttemptsTotalPerWindow: 300,
  maxAttemptsPerWindow: 30,
  windowMs: 60_000,
});

type JsonRecord = Record<string, unknown>;

export type YouTubeChatMessage = {
  messageId: string;
  userName: string;
  userAvatar: string | null;
  message: string;
  timestamp: number;
};

type YouTubeBootstrap = {
  apiKey: string;
  clientVersion: string;
  continuation: string;
  initialMessages: YouTubeChatMessage[];
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().slice(0, maxLength)
    : "";
}

function getClientKey(req: Request): string {
  return resolveClientAddress(
    req.socket.remoteAddress,
    req.header("x-forwarded-for"),
  );
}

function safeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_AVATAR_URL_LENGTH) {
    return null;
  }
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function simpleText(value: unknown): string {
  if (!isRecord(value)) return "";
  if (typeof value.simpleText === "string") return value.simpleText;
  if (!Array.isArray(value.runs)) return "";

  return value.runs
    .map((run) => {
      if (!isRecord(run)) return "";
      if (typeof run.text === "string") return run.text;
      if (!isRecord(run.emoji)) return "";
      const shortcuts = run.emoji.shortcuts;
      if (Array.isArray(shortcuts) && typeof shortcuts[0] === "string") {
        return shortcuts[0];
      }
      const accessibility = run.emoji.image;
      if (
        isRecord(accessibility) &&
        isRecord(accessibility.accessibility) &&
        isRecord(accessibility.accessibility.accessibilityData)
      ) {
        return boundedText(
          accessibility.accessibility.accessibilityData.label,
          100,
        );
      }
      return "";
    })
    .join("");
}

function firstThumbnail(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.thumbnails)) return null;
  for (let index = value.thumbnails.length - 1; index >= 0; index -= 1) {
    const thumbnail = value.thumbnails[index];
    if (isRecord(thumbnail)) {
      const safe = safeAvatarUrl(thumbnail.url);
      if (safe) return safe;
    }
  }
  return null;
}

function parseRenderer(
  renderer: JsonRecord,
  fallbackTimestamp = Date.now(),
): YouTubeChatMessage | null {
  const messageParts = [
    simpleText(renderer.message),
    simpleText(renderer.headerSubtext),
    simpleText(renderer.primaryText),
    simpleText(renderer.purchaseAmountText),
  ].filter(Boolean);

  if (isRecord(renderer.sticker)) {
    const accessibility = renderer.sticker.accessibility;
    if (isRecord(accessibility) && isRecord(accessibility.accessibilityData)) {
      const stickerLabel = boundedText(
        accessibility.accessibilityData.label,
        200,
      );
      if (stickerLabel) messageParts.push(stickerLabel);
    }
  }

  const message = Array.from(new Set(messageParts))
    .join(" · ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
  if (!message) return null;

  const timestampUsec = Number(renderer.timestampUsec);
  const timestamp =
    Number.isFinite(timestampUsec) && timestampUsec > 0
      ? Math.floor(timestampUsec / 1_000)
      : fallbackTimestamp;

  return {
    messageId:
      boundedText(renderer.id, MAX_MESSAGE_ID_LENGTH) ||
      `${timestamp}-${Math.random()}`,
    userName:
      simpleText(renderer.authorName).slice(0, MAX_USER_NAME_LENGTH) ||
      "YouTube",
    userAvatar: firstThumbnail(renderer.authorPhoto),
    message,
    timestamp,
  };
}

const MESSAGE_RENDERERS = new Set([
  "liveChatTextMessageRenderer",
  "liveChatPaidMessageRenderer",
  "liveChatPaidStickerRenderer",
  "liveChatMembershipItemRenderer",
  "liveChatSponsorshipsGiftPurchaseAnnouncementRenderer",
  "liveChatSponsorshipsGiftRedemptionAnnouncementRenderer",
]);

export function extractYouTubeMessages(
  root: unknown,
): YouTubeChatMessage[] {
  const output: YouTubeChatMessage[] = [];
  const stack: unknown[] = [root];
  const visited = new Set<object>();
  let inspected = 0;

  while (stack.length > 0 && inspected < 50_000) {
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

export function extractYouTubeContinuation(root: unknown): {
  continuation: string;
  timeoutMs: number;
} | null {
  const stack: unknown[] = [root];
  const visited = new Set<object>();
  let inspected = 0;

  while (stack.length > 0 && inspected < 50_000) {
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
    const record = current as JsonRecord;

    for (const key of [
      "timedContinuationData",
      "invalidationContinuationData",
      "reloadContinuationData",
    ]) {
      const data = record[key];
      if (isRecord(data) && typeof data.continuation === "string") {
        const rawTimeout = Number(data.timeoutMs);
        return {
          continuation: data.continuation,
          timeoutMs: Number.isFinite(rawTimeout)
            ? Math.max(1_000, Math.min(10_000, rawTimeout))
            : DEFAULT_POLL_INTERVAL_MS,
        };
      }
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }

  return null;
}

function extractAssignedJson(html: string, markers: string[]): unknown {
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

async function responseText(response: globalThis.Response): Promise<string> {
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

async function resolveHandle(handle: string): Promise<string | null> {
  const response = await fetch(
    `https://www.youtube.com/@${encodeURIComponent(handle)}/live`,
    {
      redirect: "follow",
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) return null;

  const finalUrl = new URL(response.url);
  const redirectedId =
    finalUrl.searchParams.get("v") ??
    (/^\/live\/([a-z\d_-]{6,20})$/i.exec(finalUrl.pathname)?.[1] ?? null);
  if (redirectedId && /^[a-z\d_-]{6,20}$/i.test(redirectedId)) {
    return redirectedId;
  }

  const html = await responseText(response);
  const liveMarker = html.indexOf('"isLiveNow":true');
  if (liveMarker !== -1) {
    const nearby = html.slice(
      Math.max(0, liveMarker - 4_000),
      Math.min(html.length, liveMarker + 4_000),
    );
    const externalVideoId =
      /"externalVideoId":"([a-z\d_-]{6,20})"/i.exec(nearby)?.[1] ??
      /"canonicalUrl":"https:\\?\/\\?\/www\.youtube\.com\\?\/watch\?v=([a-z\d_-]{6,20})"/i.exec(
        nearby,
      )?.[1];
    if (externalVideoId) return externalVideoId;

    const matches = Array.from(
      nearby.matchAll(/"videoId":"([a-z\d_-]{6,20})"/gi),
    );
    const candidate = matches.at(-1)?.[1];
    if (candidate) return candidate;
  }
  return null;
}

async function bootstrap(videoId: string): Promise<YouTubeBootstrap> {
  const response = await fetch(
    `https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(videoId)}`,
    {
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new Error(`YouTube returned HTTP ${response.status}`);
  }

  const html = await responseText(response);
  const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1];
  const clientVersion =
    /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1];
  const initialData = extractAssignedJson(html, [
    "window[\"ytInitialData\"] =",
    "var ytInitialData =",
    "ytInitialData =",
  ]);
  const next = extractYouTubeContinuation(initialData);

  if (!apiKey || !clientVersion || !next) {
    throw new Error("Live chat is unavailable or the stream is offline");
  }

  return {
    apiKey,
    clientVersion,
    continuation: next.continuation,
    initialMessages: extractYouTubeMessages(initialData),
  };
}

async function fetchContinuation(
  bootstrapData: Pick<YouTubeBootstrap, "apiKey" | "clientVersion">,
  continuation: string,
): Promise<unknown> {
  const response = await fetch(
    `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(bootstrapData.apiKey)}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": bootstrapData.clientVersion,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: bootstrapData.clientVersion,
            hl: "en",
          },
        },
        continuation,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new Error(`YouTube chat returned HTTP ${response.status}`);
  }
  return JSON.parse(await responseText(response));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (
      timer as ReturnType<typeof setTimeout> & {
        unref?: () => void;
      }
    ).unref?.();
  });
}

async function streamYouTubeChat(
  videoId: string,
  isClosed: () => boolean,
  send: (payload: object) => void,
): Promise<void> {
  const bootstrapData = await bootstrap(videoId);
  const seenIds = new Set<string>();

  const emitMessages = (messages: YouTubeChatMessage[]) => {
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

async function youtubeChatSSEForTarget(
  req: Request,
  res: ExpressResponse,
  resolveVideoId: () => Promise<string | null>,
): Promise<void> {
  const lease = youtubeConnectionLimiter.tryAcquire(getClientKey(req));
  if (lease.ok === false) {
    res.setHeader("Retry-After", String(lease.retryAfterSeconds));
    res.status(lease.status).json({ error: lease.reason });
    return;
  }

  let closed = false;
  let backpressured = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let maxLifetimeTimer: ReturnType<typeof setTimeout>;
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
      }
    } catch {
      cleanup();
    }
  };

  heartbeatTimer = setInterval(() => send({ type: "heartbeat" }), 25_000);
  (
    heartbeatTimer as ReturnType<typeof setInterval> & {
      unref?: () => void;
    }
  ).unref?.();

  try {
    const videoId = await resolveVideoId();
    if (!videoId || closed) {
      if (!closed) {
        send({
          type: "error",
          message: "No active YouTube live stream was found",
        });
        res.end();
      }
      return;
    }
    await streamYouTubeChat(videoId, () => closed, send);
    if (!closed) res.end();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    send({ type: "error", message });
    if (!res.writableEnded) res.end();
  }
}

export async function youtubeVideoChatSSE(
  req: Request,
  res: ExpressResponse,
): Promise<void> {
  const videoIdParam = req.params.videoId;
  const videoId = Array.isArray(videoIdParam)
    ? videoIdParam[0]
    : (videoIdParam ?? "");
  if (!/^[a-z\d_-]{6,20}$/i.test(videoId)) {
    res.status(400).json({ error: "Invalid YouTube video id" });
    return;
  }
  await youtubeChatSSEForTarget(req, res, async () => videoId);
}

export async function youtubeHandleChatSSE(
  req: Request,
  res: ExpressResponse,
): Promise<void> {
  const handleParam = req.params.handle;
  const handle = Array.isArray(handleParam)
    ? handleParam[0]
    : (handleParam ?? "");
  if (!/^[a-z\d_.-]{1,40}$/i.test(handle)) {
    res.status(400).json({ error: "Invalid YouTube handle" });
    return;
  }
  await youtubeChatSSEForTarget(req, res, () => resolveHandle(handle));
}
