const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

function isHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function normalizeChatUrl(rawUrl: string): string | null {
  const value = rawUrl.trim();
  if (!value) return null;

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;

  try {
    const url = new URL(candidate);
    if (!SUPPORTED_PROTOCOLS.has(url.protocol) || !url.hostname) return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function detectPlatform(rawUrl: string): string {
  const normalized = normalizeChatUrl(rawUrl);
  if (!normalized) return "other";

  const hostname = new URL(normalized).hostname.toLowerCase();
  if (isHost(hostname, "twitch.tv")) return "twitch";
  if (isHost(hostname, "youtube.com") || isHost(hostname, "youtu.be")) return "youtube";
  if (isHost(hostname, "kick.com")) return "kick";
  if (isHost(hostname, "facebook.com") || isHost(hostname, "fb.watch")) return "facebook";
  if (isHost(hostname, "tiktok.com")) return "tiktok";
  return "other";
}

function firstPathSegment(url: URL): string | null {
  return url.pathname.split("/").filter(Boolean)[0] ?? null;
}

export function getCurrentEmbedDomain(): string | undefined {
  const hostname = globalThis.location?.hostname;
  return typeof hostname === "string" && hostname ? hostname : undefined;
}

export function getKickChannelName(rawUrl: string): string | null {
  const normalized = normalizeChatUrl(rawUrl);
  if (!normalized || detectPlatform(normalized) !== "kick") return null;
  const channel = firstPathSegment(new URL(normalized));
  const reserved = ["browse", "categories", "dashboard", "following", "search", "settings"];
  return channel && !reserved.includes(channel.toLowerCase()) && /^[a-z\d_]{1,40}$/i.test(channel)
    ? channel
    : null;
}

function getTwitchChannel(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const first = parts[0] === "popout" || parts[0] === "embed" ? parts[1] : parts[0];
  if (!first) return null;
  if (["directory", "downloads", "jobs", "login", "p", "search", "settings", "videos"].includes(first)) {
    return null;
  }
  return /^[a-z\d_]{1,25}$/i.test(first) ? first : null;
}

function getYouTubeVideoId(url: URL): string | null {
  let candidate: string | null = null;
  if (isHost(url.hostname, "youtu.be")) candidate = firstPathSegment(url);
  if (!candidate && url.searchParams.get("v")) candidate = url.searchParams.get("v");

  const parts = url.pathname.split("/").filter(Boolean);
  if (!candidate && ["live", "embed", "shorts"].includes(parts[0])) candidate = parts[1] ?? null;
  return candidate && /^[a-z\d_-]{6,20}$/i.test(candidate) ? candidate : null;
}

export function isResolvableChatUrl(rawUrl: string, selectedPlatform?: string): boolean {
  const normalized = normalizeChatUrl(rawUrl);
  if (!normalized) return false;
  const detectedPlatform = detectPlatform(normalized);
  const platform = selectedPlatform || detectedPlatform;
  if (["twitch", "youtube", "kick"].includes(platform) && platform !== detectedPlatform) return false;

  const url = new URL(normalized);
  if (platform === "twitch") return getTwitchChannel(url) !== null;
  if (platform === "youtube") return getYouTubeVideoId(url) !== null;
  if (platform === "kick") return getKickChannelName(normalized) !== null;
  return true;
}

export function getChatEmbedUrl(rawUrl: string, embedDomain?: string): string {
  const normalized = normalizeChatUrl(rawUrl);
  if (!normalized) return "https://example.invalid/";

  const url = new URL(normalized);
  const platform = detectPlatform(normalized);

  if (platform === "twitch") {
    const channel = getTwitchChannel(url);
    if (channel) {
      if (embedDomain) {
        return `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=${encodeURIComponent(embedDomain)}&darkpopout`;
      }
      return `https://www.twitch.tv/popout/${encodeURIComponent(channel)}/chat?darkpopout`;
    }
  }

  if (platform === "youtube") {
    const videoId = getYouTubeVideoId(url);
    if (videoId) {
      const params = new URLSearchParams({ v: videoId, dark_theme: "1", is_popout: "1" });
      if (embedDomain) params.set("embed_domain", embedDomain);
      return `https://www.youtube.com/live_chat?${params.toString()}`;
    }
  }

  if (platform === "kick") {
    const channel = getKickChannelName(normalized);
    if (channel) return `https://kick.com/${encodeURIComponent(channel)}/chatroom`;
  }

  return normalized;
}
