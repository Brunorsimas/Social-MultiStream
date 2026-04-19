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

const MAX_MESSAGES = 500;
const MAX_SEEN_IDS = 5000;
const NOTIFY_THROTTLE_MS = 150;

export class MessageAggregator {
  private messages: UnifiedChatMessage[] = [];
  private seenIds: Set<string> = new Set();
  private listeners: Set<(messages: UnifiedChatMessage[]) => void> = new Set();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  addMessage(msg: UnifiedChatMessage): void {
    if (!msg.message || !msg.message.trim()) return;
    if (this.seenIds.has(msg.messageId)) return;

    this.seenIds.add(msg.messageId);
    this.messages.push(msg);
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
      if (!msg.message || !msg.message.trim()) continue;
      if (this.seenIds.has(msg.messageId)) continue;
      this.seenIds.add(msg.messageId);
      this.messages.push(msg);
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
    return () => {
      this.listeners.delete(listener);
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
    this.listeners.forEach((fn) => fn(snapshot));
  }
}

export const globalAggregator = new MessageAggregator();
