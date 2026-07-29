import type { ChatConfig } from "./storage.ts";
import {
  getKickChannelName,
  getTwitchChannelName,
  getYouTubeChatTarget,
} from "./chat-url.ts";

export function shouldRetryWebChatError(payload: unknown): boolean {
  return (
    typeof payload !== "object" ||
    payload === null ||
    !("retryable" in payload) ||
    payload.retryable !== false
  );
}

export function getWebChatEndpoint(
  chat: Pick<ChatConfig, "platform" | "url">,
): string | null {
  if (chat.platform === "kick") {
    const channel = getKickChannelName(chat.url);
    return channel
      ? `/api/kick/chat/${encodeURIComponent(channel)}`
      : null;
  }

  if (chat.platform === "twitch") {
    const channel = getTwitchChannelName(chat.url);
    return channel
      ? `/api/twitch/chat/${encodeURIComponent(channel)}`
      : null;
  }

  if (chat.platform === "youtube") {
    const target = getYouTubeChatTarget(chat.url);
    return target
      ? `/api/youtube/chat/${target.type}/${encodeURIComponent(target.value)}`
      : null;
  }

  return null;
}
