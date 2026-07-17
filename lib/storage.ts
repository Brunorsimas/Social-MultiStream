import AsyncStorage from "@react-native-async-storage/async-storage";
import { detectPlatform, getChatEmbedUrl, normalizeChatUrl } from "./chat-url";

export { detectPlatform, getChatEmbedUrl, normalizeChatUrl } from "./chat-url";

export interface ChatConfig {
  id: string;
  name: string;
  url: string;
  platform: string;
  enabled: boolean;
  pinned: boolean;
  order: number;
}

export interface AppSettings {
  layout: "columns" | "grid" | "list" | "merged";
  fontSize: number;
  streamerMode: boolean;
  keepScreenOn: boolean;
  unifiedMode: boolean;
}

const CHATS_KEY = "@streamchat_chats";
const SETTINGS_KEY = "@streamchat_settings";

export const defaultSettings: AppSettings = {
  layout: "columns",
  fontSize: 14,
  streamerMode: false,
  keepScreenOn: true,
  unifiedMode: false,
};

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeChats(value: unknown): ChatConfig[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  return value.flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    const normalizedUrl = normalizeChatUrl(typeof candidate.url === "string" ? candidate.url : "");
    if (!normalizedUrl) return [];

    const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : generateId();
    if (seenIds.has(id)) return [];
    seenIds.add(id);

    const name = typeof candidate.name === "string" && candidate.name.trim()
      ? candidate.name.trim()
      : `Chat ${index + 1}`;
    const detectedPlatform = detectPlatform(normalizedUrl);

    return [{
      id,
      name,
      url: normalizedUrl,
      platform: typeof candidate.platform === "string" && candidate.platform.trim()
        ? candidate.platform.toLowerCase()
        : detectedPlatform,
      enabled: candidate.enabled !== false,
      pinned: candidate.pinned === true,
      order: Number.isFinite(candidate.order) ? Number(candidate.order) : index,
    }];
  })
    .sort((a, b) => a.order - b.order)
    .map((chat, order) => ({ ...chat, order }));
}

function sanitizeSettings(value: unknown): AppSettings {
  if (!isRecord(value)) return { ...defaultSettings };
  const validLayouts: AppSettings["layout"][] = ["columns", "grid", "list", "merged"];
  const layout = validLayouts.includes(value.layout as AppSettings["layout"])
    ? value.layout as AppSettings["layout"]
    : defaultSettings.layout;
  const fontSize = typeof value.fontSize === "number" && Number.isFinite(value.fontSize)
    ? Math.max(10, Math.min(24, value.fontSize))
    : defaultSettings.fontSize;

  return {
    layout,
    fontSize,
    streamerMode: typeof value.streamerMode === "boolean" ? value.streamerMode : defaultSettings.streamerMode,
    keepScreenOn: typeof value.keepScreenOn === "boolean" ? value.keepScreenOn : defaultSettings.keepScreenOn,
    unifiedMode: typeof value.unifiedMode === "boolean" ? value.unifiedMode : defaultSettings.unifiedMode,
  };
}

export function createChatConfig(
  chat: Omit<ChatConfig, "id" | "order">,
  order: number,
): ChatConfig {
  const normalizedUrl = normalizeChatUrl(chat.url);
  if (!normalizedUrl) throw new Error("Invalid chat URL");
  return {
    ...chat,
    id: generateId(),
    name: chat.name.trim(),
    url: normalizedUrl,
    platform: chat.platform || detectPlatform(normalizedUrl),
    order,
  };
}

export async function getChats(): Promise<ChatConfig[]> {
  try {
    const data = await AsyncStorage.getItem(CHATS_KEY);
    if (data) {
      return sanitizeChats(JSON.parse(data));
    }
    return [];
  } catch {
    return [];
  }
}

export async function saveChats(chats: ChatConfig[]): Promise<void> {
  await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(sanitizeChats(chats)));
}

export async function addChat(chat: Omit<ChatConfig, "id" | "order">): Promise<ChatConfig> {
  const chats = await getChats();
  const newChat = createChatConfig(chat, chats.length);
  chats.push(newChat);
  await saveChats(chats);
  return newChat;
}

export async function updateChat(id: string, updates: Partial<ChatConfig>): Promise<void> {
  const chats = await getChats();
  const index = chats.findIndex((c) => c.id === id);
  if (index !== -1) {
    chats[index] = { ...chats[index], ...updates };
    await saveChats(chats);
  }
}

export async function removeChat(id: string): Promise<void> {
  let chats = await getChats();
  chats = chats.filter((c) => c.id !== id);
  chats.forEach((c, i) => (c.order = i));
  await saveChats(chats);
}

export async function reorderChats(orderedIds: string[]): Promise<void> {
  const chats = await getChats();
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  const requested = orderedIds.flatMap((id) => {
    const chat = byId.get(id);
    if (!chat) return [];
    byId.delete(id);
    return [chat];
  });
  const ordered = [...requested, ...byId.values()].map((chat, order) => ({ ...chat, order }));
  await saveChats(ordered);
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const data = await AsyncStorage.getItem(SETTINGS_KEY);
    if (data) {
      return sanitizeSettings(JSON.parse(data));
    }
    return { ...defaultSettings };
  } catch {
    return { ...defaultSettings };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)));
}
