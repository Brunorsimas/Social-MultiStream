const MAX_BRIDGE_PAYLOAD_CHARS = 256_000;
const MAX_MESSAGES_PER_EVENT = 50;
const MAX_MESSAGE_ID_LENGTH = 200;
const MAX_CHAT_ID_LENGTH = 100;
const MAX_CHAT_NAME_LENGTH = 100;
const MAX_USER_NAME_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_AVATAR_URL_LENGTH = 2_048;

const PLATFORM_DOMAINS: Record<string, string[]> = {
  twitch: ["twitch.tv"],
  youtube: ["youtube.com", "youtu.be", "google.com"],
  kick: ["kick.com"],
  facebook: ["facebook.com", "fb.com"],
  tiktok: ["tiktok.com"],
};

const COLLECTOR_DOMAINS: Record<string, string[]> = {
  twitch: ["twitch.tv"],
  youtube: ["youtube.com", "youtu.be"],
  kick: ["kick.com"],
  facebook: ["facebook.com", "fb.com"],
  tiktok: ["tiktok.com"],
};

const MESSAGE_PLATFORMS = new Set([
  "youtube",
  "twitch",
  "kick",
  "facebook",
  "tiktok",
]);

export interface CollectorChat {
  id: string;
  name: string;
  platform: string;
}

export interface SafeCollectorMessage {
  messageId: string;
  platform: "youtube" | "twitch" | "kick" | "facebook" | "tiktok" | "unknown";
  chatId: string;
  chatName: string;
  userName: string;
  userAvatar: string | null;
  message: string;
  timestamp: number;
}

function parseWebUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || !url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

function isHostInDomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

function isKnownPlatformHost(hostname: string, platform: string): boolean {
  return (PLATFORM_DOMAINS[platform.toLowerCase()] ?? []).some((domain) =>
    isHostInDomain(hostname, domain),
  );
}

export function normalizeWebViewUrl(rawUrl: string): string | null {
  return parseWebUrl(rawUrl)?.href ?? null;
}

export function getWebViewOriginWhitelist(
  initialUrl: string,
  platform: string,
): string[] {
  const domains = PLATFORM_DOMAINS[platform.toLowerCase()];
  if (domains?.length) {
    return domains.flatMap((domain) => [
      `https://${domain}/*`,
      `https://*.${domain}/*`,
    ]);
  }

  const initial = parseWebUrl(initialUrl);
  return initial ? [`${initial.origin}/*`] : [];
}

export function isAllowedWebViewNavigation(
  candidateUrl: string,
  initialUrl: string,
  platform: string,
): boolean {
  const candidate = parseWebUrl(candidateUrl);
  const initial = parseWebUrl(initialUrl);
  if (!candidate || !initial) return false;

  const normalizedPlatform = platform.toLowerCase();
  if (PLATFORM_DOMAINS[normalizedPlatform]) {
    return (
      candidate.protocol === "https:" &&
      isKnownPlatformHost(candidate.hostname, normalizedPlatform)
    );
  }

  return candidate.origin === initial.origin;
}

export function shouldShareWebViewCookies(
  initialUrl: string,
  platform: string,
): boolean {
  const initial = parseWebUrl(initialUrl);
  return Boolean(
    initial &&
      initial.protocol === "https:" &&
      isKnownPlatformHost(initial.hostname, platform.toLowerCase()),
  );
}

function isAllowedCollectorEventUrl(
  candidateUrl: string,
  initialUrl: string,
  platform: string,
): boolean {
  const candidate = parseWebUrl(candidateUrl);
  const initial = parseWebUrl(initialUrl);
  if (!candidate || !initial) return false;

  const normalizedPlatform = platform.toLowerCase();
  const domains = COLLECTOR_DOMAINS[normalizedPlatform];
  if (domains) {
    return (
      candidate.protocol === "https:" &&
      domains.some((domain) => isHostInDomain(candidate.hostname, domain))
    );
  }

  return candidate.origin === initial.origin;
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
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeCollectorEvent(
  rawPayload: unknown,
  sourceUrl: string,
  eventUrl: unknown,
  chat: CollectorChat,
): SafeCollectorMessage[] {
  if (
    typeof rawPayload !== "string" ||
    rawPayload.length > MAX_BRIDGE_PAYLOAD_CHARS
  ) {
    return [];
  }

  if (
    typeof eventUrl === "string" &&
    eventUrl &&
    !isAllowedCollectorEventUrl(eventUrl, sourceUrl, chat.platform)
  ) {
    return [];
  }

  let data: unknown;
  try {
    data = JSON.parse(rawPayload);
  } catch {
    return [];
  }

  if (
    typeof data !== "object" ||
    data === null ||
    (data as { type?: unknown }).type !== "chat_messages" ||
    !Array.isArray((data as { messages?: unknown }).messages)
  ) {
    return [];
  }

  const chatId = boundedString(chat.id, MAX_CHAT_ID_LENGTH);
  const chatName =
    boundedString(chat.name, MAX_CHAT_NAME_LENGTH) || "Chat";
  if (!chatId) return [];

  const platform = MESSAGE_PLATFORMS.has(chat.platform)
    ? (chat.platform as SafeCollectorMessage["platform"])
    : "unknown";
  const rawMessages = (data as { messages: unknown[] }).messages.slice(
    0,
    MAX_MESSAGES_PER_EVENT,
  );

  return rawMessages.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const raw = candidate as Record<string, unknown>;
    const messageId = boundedString(raw.messageId, MAX_MESSAGE_ID_LENGTH);
    const message = boundedString(raw.message, MAX_MESSAGE_LENGTH);
    if (!messageId || !message) return [];

    const timestamp = Number(raw.timestamp);
    return [
      {
        messageId,
        platform,
        chatId,
        chatName,
        userName:
          boundedString(raw.userName, MAX_USER_NAME_LENGTH) || "Unknown",
        userAvatar: safeAvatarUrl(raw.userAvatar),
        message,
        timestamp:
          Number.isFinite(timestamp) && timestamp > 0
            ? timestamp
            : Date.now(),
      },
    ];
  });
}
