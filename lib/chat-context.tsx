import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from "react";
import {
  ChatConfig,
  AppSettings,
  getChats,
  saveChats,
  addChat as addChatStorage,
  updateChat as updateChatStorage,
  removeChat as removeChatStorage,
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

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [loadedChats, loadedSettings] = await Promise.all([getChats(), getSettings()]);
    setChats(loadedChats.sort((a, b) => a.order - b.order));
    setSettings(loadedSettings);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addChat = useCallback(async (chat: Omit<ChatConfig, "id" | "order">) => {
    const newChat = await addChatStorage(chat);
    setChats((prev) => [...prev, newChat]);
  }, []);

  const updateChat = useCallback(async (id: string, updates: Partial<ChatConfig>) => {
    await updateChatStorage(id, updates);
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  }, []);

  const removeChat = useCallback(async (id: string) => {
    await removeChatStorage(id);
    setChats((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      filtered.forEach((c, i) => (c.order = i));
      return filtered;
    });
  }, []);

  const toggleChat = useCallback(
    async (id: string) => {
      const chat = chats.find((c) => c.id === id);
      if (chat) {
        await updateChatStorage(id, { enabled: !chat.enabled });
        setChats((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));
      }
    },
    [chats]
  );

  const togglePin = useCallback(
    async (id: string) => {
      const chat = chats.find((c) => c.id === id);
      if (chat) {
        await updateChatStorage(id, { pinned: !chat.pinned });
        setChats((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)));
      }
    },
    [chats]
  );

  const moveChat = useCallback(
    async (fromIndex: number, toIndex: number) => {
      setChats((prev) => {
        const updated = [...prev];
        const [moved] = updated.splice(fromIndex, 1);
        updated.splice(toIndex, 0, moved);
        updated.forEach((c, i) => (c.order = i));
        saveChats(updated);
        return updated;
      });
    },
    []
  );

  const updateSettings = useCallback(async (updates: Partial<AppSettings>) => {
    setSettings((prev) => {
      const newSettings = { ...prev, ...updates };
      saveSettings(newSettings);
      return newSettings;
    });
  }, []);

  const refreshChats = useCallback(async () => {
    const loaded = await getChats();
    setChats(loaded.sort((a, b) => a.order - b.order));
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
