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

export class MessageAggregator {
  private messages: UnifiedChatMessage[] = [];
  private seenIds: Set<string> = new Set();
  private listeners: Set<(messages: UnifiedChatMessage[]) => void> = new Set();

  addMessage(msg: UnifiedChatMessage): void {
    if (this.seenIds.has(msg.messageId)) return;

    this.seenIds.add(msg.messageId);
    this.messages.push(msg);

    this.messages.sort((a, b) => a.timestamp - b.timestamp);

    if (this.messages.length > MAX_MESSAGES) {
      const removed = this.messages.splice(0, this.messages.length - MAX_MESSAGES);
      removed.forEach((m) => this.seenIds.delete(m.messageId));
    }

    this.notify();
  }

  addMessages(msgs: UnifiedChatMessage[]): void {
    let changed = false;
    for (const msg of msgs) {
      if (this.seenIds.has(msg.messageId)) continue;
      this.seenIds.add(msg.messageId);
      this.messages.push(msg);
      changed = true;
    }

    if (changed) {
      this.messages.sort((a, b) => a.timestamp - b.timestamp);

      if (this.messages.length > MAX_MESSAGES) {
        const removed = this.messages.splice(0, this.messages.length - MAX_MESSAGES);
        removed.forEach((m) => this.seenIds.delete(m.messageId));
      }

      this.notify();
    }
  }

  getMessages(): UnifiedChatMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
    this.seenIds.clear();
    this.notify();
  }

  subscribe(listener: (messages: UnifiedChatMessage[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getMessages();
    this.listeners.forEach((fn) => fn(snapshot));
  }
}

export const globalAggregator = new MessageAggregator();
