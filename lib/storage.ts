import AsyncStorage from "@react-native-async-storage/async-storage";

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
  layout: "columns" | "grid" | "list";
  fontSize: number;
  streamerMode: boolean;
  keepScreenOn: boolean;
}

const CHATS_KEY = "@streamchat_chats";
const SETTINGS_KEY = "@streamchat_settings";

const defaultSettings: AppSettings = {
  layout: "columns",
  fontSize: 14,
  streamerMode: false,
  keepScreenOn: true,
};

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export function detectPlatform(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes("twitch.tv") || lower.includes("twitch")) return "twitch";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("kick.com")) return "kick";
  if (lower.includes("facebook.com") || lower.includes("fb.")) return "facebook";
  if (lower.includes("tiktok.com")) return "tiktok";
  return "other";
}

export function getChatEmbedUrl(url: string): string {
  const platform = detectPlatform(url);

  if (platform === "twitch") {
    const match = url.match(/twitch\.tv\/(?:popout\/)?(\w+)(?:\/chat)?/);
    if (match) {
      const channel = match[1];
      return `https://www.twitch.tv/popout/${channel}/chat?darkpopout`;
    }
  }

  if (platform === "youtube") {
    const liveMatch = url.match(/(?:youtube\.com\/live\/|youtu\.be\/)([^?&/]+)/);
    const watchMatch = url.match(/(?:youtube\.com\/watch\?v=)([^&]+)/);
    const videoId = liveMatch?.[1] || watchMatch?.[1];
    if (videoId) {
      return `https://www.youtube.com/live_chat?v=${videoId}&embed_domain=localhost&dark_theme=1`;
    }
  }

  if (platform === "kick") {
    const match = url.match(/kick\.com\/(\w+)/);
    if (match) {
      return `https://kick.com/${match[1]}/chatroom`;
    }
  }

  return url;
}

export async function getChats(): Promise<ChatConfig[]> {
  try {
    const data = await AsyncStorage.getItem(CHATS_KEY);
    if (data) {
      return JSON.parse(data);
    }
    return [];
  } catch {
    return [];
  }
}

export async function saveChats(chats: ChatConfig[]): Promise<void> {
  await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(chats));
}

export async function addChat(chat: Omit<ChatConfig, "id" | "order">): Promise<ChatConfig> {
  const chats = await getChats();
  const newChat: ChatConfig = {
    ...chat,
    id: generateId(),
    order: chats.length,
  };
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
  const ordered = orderedIds
    .map((id, i) => {
      const chat = chats.find((c) => c.id === id);
      if (chat) return { ...chat, order: i };
      return null;
    })
    .filter(Boolean) as ChatConfig[];
  await saveChats(ordered);
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const data = await AsyncStorage.getItem(SETTINGS_KEY);
    if (data) {
      return { ...defaultSettings, ...JSON.parse(data) };
    }
    return defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
