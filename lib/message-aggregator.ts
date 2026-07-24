export type ChatPlatform = "youtube" | "twitch" | "kick" | "facebook" | "tiktok" | "unknown";

export interface UnifiedChatMessage {
  messageId: string;
  platform: ChatPlatform;
  chatId: string;
  chatName: string;
  userName: string;
  userAvatar: string | null;
  message: string;
  timestamp: number;
}

export const MAX_MESSAGES = 500;
const MAX_SEEN_IDS = 5000;
const NOTIFY_THROTTLE_MS = 150;
const MAX_MESSAGE_ID_LENGTH = 200;
const MAX_CHAT_ID_LENGTH = 100;
const MAX_CHAT_NAME_LENGTH = 100;
const MAX_USER_NAME_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_AVATAR_URL_LENGTH = 2_048;
const VALID_PLATFORMS = new Set<ChatPlatform>([
  "youtube",
  "twitch",
  "kick",
  "facebook",
  "tiktok",
  "unknown",
]);

export class MessageAggregator {
  private messages: UnifiedChatMessage[] = [];
  private seenIds: Set<string> = new Set();
  private listeners: Set<(messages: UnifiedChatMessage[]) => void> = new Set();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  addMessage(msg: UnifiedChatMessage): void {
    const normalized = this.normalizeMessage(msg);
    if (!normalized) return;
    const dedupeKey = this.getDedupeKey(normalized);
    if (this.seenIds.has(dedupeKey)) return;

    this.seenIds.add(dedupeKey);
    this.messages.push(normalized);
    this.messages.sort((a, b) => a.timestamp - b.timestamp);

    if (this.messages.length > MAX_MESSAGES) {
      this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    }

    this.trimSeenIds();
    this.scheduleNotify();
  }

  addMessages(msgs: UnifiedChatMessage[]): void {
    let changed = false;
    for (const msg of msgs) {
      const normalized = this.normalizeMessage(msg);
      if (!normalized) continue;
      const dedupeKey = this.getDedupeKey(normalized);
      if (this.seenIds.has(dedupeKey)) continue;
      this.seenIds.add(dedupeKey);
      this.messages.push(normalized);
      changed = true;
    }

    if (changed) {
      this.messages.sort((a, b) => a.timestamp - b.timestamp);

      if (this.messages.length > MAX_MESSAGES) {
        this.messages.splice(0, this.messages.length - MAX_MESSAGES);
      }

      this.trimSeenIds();
      this.scheduleNotify();
    }
  }

  getMessages(): UnifiedChatMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
    this.seenIds.clear();
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.notify();
  }

  subscribe(listener: (messages: UnifiedChatMessage[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getMessages());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private getDedupeKey(msg: UnifiedChatMessage): string {
    return `${msg.chatId}\u0000${msg.messageId}`;
  }

  private normalizeMessage(msg: UnifiedChatMessage): UnifiedChatMessage | null {
    const messageId = String(msg.messageId ?? "")
      .trim()
      .slice(0, MAX_MESSAGE_ID_LENGTH);
    const chatId = String(msg.chatId ?? "")
      .trim()
      .slice(0, MAX_CHAT_ID_LENGTH);
    const message = String(msg.message ?? "")
      .trim()
      .slice(0, MAX_MESSAGE_LENGTH);
    if (!messageId || !chatId || !message) return null;

    const timestamp = Number(msg.timestamp);
    let userAvatar: string | null = null;
    if (
      typeof msg.userAvatar === "string" &&
      msg.userAvatar.length <= MAX_AVATAR_URL_LENGTH
    ) {
      try {
        const avatarUrl = new URL(msg.userAvatar);
        if (
          avatarUrl.protocol === "https:" &&
          !avatarUrl.username &&
          !avatarUrl.password
        ) {
          userAvatar = avatarUrl.href;
        }
      } catch {}
    }

    return {
      ...msg,
      messageId,
      chatId,
      chatName:
        String(msg.chatName ?? "Chat").trim().slice(0, MAX_CHAT_NAME_LENGTH) ||
        "Chat",
      userName:
        String(msg.userName ?? "Unknown")
          .trim()
          .slice(0, MAX_USER_NAME_LENGTH) || "Unknown",
      userAvatar,
      message,
      platform: VALID_PLATFORMS.has(msg.platform) ? msg.platform : "unknown",
      timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
    };
  }

  private trimSeenIds(): void {
    if (this.seenIds.size > MAX_SEEN_IDS) {
      const arr = Array.from(this.seenIds);
      this.seenIds = new Set(arr.slice(arr.length - MAX_SEEN_IDS));
    }
  }

  private scheduleNotify(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.notify();
    }, NOTIFY_THROTTLE_MS);
  }

  private notify(): void {
    const snapshot = this.getMessages();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch {
        // A broken consumer must not prevent other subscribers from updating.
      }
    });
  }
}

export const globalAggregator = new MessageAggregator();
