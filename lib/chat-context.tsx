import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from "react";
import {
  ChatConfig,
  AppSettings,
  getChats,
  saveChats,
  createChatConfig,
  getSettings,
  saveSettings,
} from "./storage";

interface ChatContextValue {
  chats: ChatConfig[];
  settings: AppSettings;
  isLoading: boolean;
  addChat: (chat: Omit<ChatConfig, "id" | "order">) => Promise<void>;
  updateChat: (id: string, updates: Partial<ChatConfig>) => Promise<void>;
  removeChat: (id: string) => Promise<void>;
  toggleChat: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  moveChat: (fromIndex: number, toIndex: number) => Promise<void>;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  refreshChats: () => Promise<void>;
  activeChats: ChatConfig[];
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<ChatConfig[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    layout: "columns",
    fontSize: 14,
    streamerMode: false,
    keepScreenOn: true,
    unifiedMode: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const chatsRef = useRef<ChatConfig[]>([]);
  const persistedChatsRef = useRef<ChatConfig[]>([]);
  const settingsRef = useRef(settings);
  const persistedSettingsRef = useRef(settings);
  const chatsWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const settingsWriteQueue = useRef<Promise<void>>(Promise.resolve());

  const commitChats = useCallback(async (next: ChatConfig[]) => {
    chatsRef.current = next;
    setChats(next);
    const write = chatsWriteQueue.current.catch(() => undefined).then(() => saveChats(next));
    chatsWriteQueue.current = write;
    try {
      await write;
      persistedChatsRef.current = next;
    } catch (error) {
      if (chatsRef.current === next) {
        chatsRef.current = persistedChatsRef.current;
        setChats(persistedChatsRef.current);
      }
      throw error;
    }
  }, []);

  const commitSettings = useCallback(async (next: AppSettings) => {
    settingsRef.current = next;
    setSettings(next);
    const write = settingsWriteQueue.current.catch(() => undefined).then(() => saveSettings(next));
    settingsWriteQueue.current = write;
    try {
      await write;
      persistedSettingsRef.current = next;
    } catch (error) {
      if (settingsRef.current === next) {
        settingsRef.current = persistedSettingsRef.current;
        setSettings(persistedSettingsRef.current);
      }
      throw error;
    }
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [loadedChats, loadedSettings] = await Promise.all([getChats(), getSettings()]);
    const sortedChats = [...loadedChats].sort((a, b) => a.order - b.order);
    chatsRef.current = sortedChats;
    persistedChatsRef.current = sortedChats;
    settingsRef.current = loadedSettings;
    persistedSettingsRef.current = loadedSettings;
    setChats(sortedChats);
    setSettings(loadedSettings);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addChat = useCallback(async (chat: Omit<ChatConfig, "id" | "order">) => {
    const newChat = createChatConfig(chat, chatsRef.current.length);
    await commitChats([...chatsRef.current, newChat]);
  }, [commitChats]);

  const updateChat = useCallback(async (id: string, updates: Partial<ChatConfig>) => {
    const next = chatsRef.current.map((chat) => (
      chat.id === id ? { ...chat, ...updates, id: chat.id, order: chat.order } : chat
    ));
    await commitChats(next);
  }, [commitChats]);

  const removeChat = useCallback(async (id: string) => {
    const next = chatsRef.current
      .filter((chat) => chat.id !== id)
      .map((chat, order) => ({ ...chat, order }));
    await commitChats(next);
  }, [commitChats]);

  const toggleChat = useCallback(
    async (id: string) => {
      const chat = chatsRef.current.find((candidate) => candidate.id === id);
      if (chat) {
        await updateChat(id, { enabled: !chat.enabled });
      }
    },
    [updateChat]
  );

  const togglePin = useCallback(
    async (id: string) => {
      const chat = chatsRef.current.find((candidate) => candidate.id === id);
      if (chat) {
        await updateChat(id, { pinned: !chat.pinned });
      }
    },
    [updateChat]
  );

  const moveChat = useCallback(
    async (fromIndex: number, toIndex: number) => {
      const current = chatsRef.current;
      if (fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length || fromIndex === toIndex) {
        return;
      }
      const reordered = [...current];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      await commitChats(reordered.map((chat, order) => ({ ...chat, order })));
    },
    [commitChats]
  );

  const updateSettings = useCallback(async (updates: Partial<AppSettings>) => {
    await commitSettings({ ...settingsRef.current, ...updates });
  }, [commitSettings]);

  const refreshChats = useCallback(async () => {
    const loaded = await getChats();
    const sorted = [...loaded].sort((a, b) => a.order - b.order);
    chatsRef.current = sorted;
    persistedChatsRef.current = sorted;
    setChats(sorted);
  }, []);

  const activeChats = useMemo(
    () => chats.filter((c) => c.enabled).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.order - b.order),
    [chats]
  );

  const value = useMemo(
    () => ({
      chats,
      settings,
      isLoading,
      addChat,
      updateChat,
      removeChat,
      toggleChat,
      togglePin,
      moveChat,
      updateSettings,
      refreshChats,
      activeChats,
    }),
    [chats, settings, isLoading, addChat, updateChat, removeChat, toggleChat, togglePin, moveChat, updateSettings, refreshChats, activeChats]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChats() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChats must be used within a ChatProvider");
  }
  return context;
}
