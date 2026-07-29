import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform, FlatList } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { ThemeColors } from "@/constants/colors";
import PlatformBadge from "./PlatformBadge";
import KickWebChat from "./KickWebChat";
import { ChatConfig, getChatEmbedUrl } from "@/lib/storage";
import {
  getCurrentEmbedDomain,
  getKickChannelName,
  getYouTubeChatRedirect,
  isAllowedYouTubeChatNavigation,
  isYouTubeLiveChatUrl,
  shouldIgnoreYouTubeLoadEnd,
} from "@/lib/chat-url";
import { useChats } from "@/lib/chat-context";
import {
  getWebViewOriginWhitelist,
  isAllowedWebViewNavigation,
} from "@/lib/webview-security";
import {
  getYouTubeChatUrlFromMessage,
  getYouTubeVideoIdExtractorScript,
  YOUTUBE_VIDEO_ID_RESOLUTION_TIMEOUT_MS,
} from "@/lib/youtube-webview";

interface MergedChatViewProps {
  chats: ChatConfig[];
  fontSize?: number;
}

interface TabItemProps {
  chat: ChatConfig;
  isActive: boolean;
  onPress: () => void;
}

function TabItem({ chat, isActive, onPress }: TabItemProps) {
  const { themeColors } = useChats();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, isActive && styles.tabActive]}
    >
      <PlatformBadge platform={chat.platform} size={12} />
      <Text style={[styles.tabText, isActive && styles.tabTextActive]} numberOfLines={1}>
        {chat.name}
      </Text>
      {chat.pinned && <Ionicons name="pin" size={10} color={themeColors.warning} />}
    </Pressable>
  );
}

function getMergedChatSourceUrl(chat: ChatConfig): string {
  return getChatEmbedUrl(
    chat.url,
    Platform.OS === "web" ? getCurrentEmbedDomain() : undefined,
  );
}

function getMergedChatSourceKey(chat: ChatConfig): string {
  return `${chat.platform}:${getMergedChatSourceUrl(chat)}`;
}

export default function MergedChatView({ chats, fontSize = 14 }: MergedChatViewProps) {
  const { themeColors } = useChats();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [activeIndex, setActiveIndex] = useState(0);
  const webViewRefs = useRef<Record<string, WebView | null>>({});
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>(
    Object.fromEntries(chats.map((c) => [c.id, true]))
  );
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});
  const resolvedUrlsRef = useRef<Record<string, string>>({});
  const configuredSourceKeysRef = useRef<Record<string, string>>(
    Object.fromEntries(
      chats.map((chat) => [chat.id, getMergedChatSourceKey(chat)]),
    ),
  );
  const youtubeResolveTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});

  const clearYouTubeResolveTimer = useCallback((chatId: string) => {
    const timer = youtubeResolveTimersRef.current[chatId];
    if (!timer) return;
    clearTimeout(timer);
    delete youtubeResolveTimersRef.current[chatId];
  }, []);

  useEffect(
    () => () => {
      Object.values(youtubeResolveTimersRef.current).forEach(clearTimeout);
      youtubeResolveTimersRef.current = {};
    },
    [],
  );

  useLayoutEffect(() => {
    const previousKeys = configuredSourceKeysRef.current;
    const nextKeys = Object.fromEntries(
      chats.map((chat) => [chat.id, getMergedChatSourceKey(chat)]),
    );
    const changedIds = new Set([
      ...Object.keys(previousKeys).filter(
        (chatId) => previousKeys[chatId] !== nextKeys[chatId],
      ),
      ...Object.keys(nextKeys).filter(
        (chatId) => previousKeys[chatId] !== nextKeys[chatId],
      ),
    ]);

    configuredSourceKeysRef.current = nextKeys;
    if (changedIds.size === 0) return;

    changedIds.forEach((chatId) => {
      clearYouTubeResolveTimer(chatId);
      delete resolvedUrlsRef.current[chatId];
    });
    setResolvedUrls((previous) => {
      const next = { ...previous };
      changedIds.forEach((chatId) => delete next[chatId]);
      return next;
    });
    setLoadingStates((previous) =>
      Object.fromEntries(
        chats.map((chat) => [
          chat.id,
          changedIds.has(chat.id) ? true : (previous[chat.id] ?? true),
        ]),
      ),
    );
  }, [chats, clearYouTubeResolveTimer]);

  const safeIndex = Math.min(activeIndex, chats.length - 1);
  const activeChat = chats[safeIndex] || chats[0];

  if (!activeChat) return null;

  const injectedCSS = `
    (function() {
      var style = document.createElement('style');
      style.textContent = 'body { font-size: ${fontSize}px !important; background: ${themeColors.background} !important; color: ${themeColors.text} !important; } * { font-size: inherit; }';
      document.head.appendChild(style);
    })();
    true;
  `;

  const handleLoadEnd = (
    chat: ChatConfig,
    sourceKey: string,
    sourceUrl: string,
    finalUrl: string,
  ) => {
    if (configuredSourceKeysRef.current[chat.id] !== sourceKey) return;

    if (chat.platform === "youtube") {
      const activeSourceUrl = resolvedUrlsRef.current[chat.id] || sourceUrl;
      if (shouldIgnoreYouTubeLoadEnd(activeSourceUrl, finalUrl)) return;

      const redirectedChatUrl = getYouTubeChatRedirect(
        activeSourceUrl,
        finalUrl,
      );
      if (redirectedChatUrl) {
        clearYouTubeResolveTimer(chat.id);
        resolvedUrlsRef.current[chat.id] = redirectedChatUrl;
        setResolvedUrls((prev) => ({
          ...prev,
          [chat.id]: redirectedChatUrl,
        }));
        setLoadingStates((prev) => ({ ...prev, [chat.id]: true }));
        return;
      }
      if (!isYouTubeLiveChatUrl(finalUrl)) {
        clearYouTubeResolveTimer(chat.id);
        setLoadingStates((prev) => ({ ...prev, [chat.id]: true }));
        webViewRefs.current[chat.id]?.injectJavaScript(
          getYouTubeVideoIdExtractorScript(activeSourceUrl),
        );
        youtubeResolveTimersRef.current[chat.id] = setTimeout(() => {
          delete youtubeResolveTimersRef.current[chat.id];
          if (
            configuredSourceKeysRef.current[chat.id] !== sourceKey
          ) {
            return;
          }
          const currentUrl =
            resolvedUrlsRef.current[chat.id] || sourceUrl;
          if (!isYouTubeLiveChatUrl(currentUrl)) {
            setLoadingStates((prev) => ({ ...prev, [chat.id]: false }));
          }
        }, YOUTUBE_VIDEO_ID_RESOLUTION_TIMEOUT_MS);
        return;
      }

      clearYouTubeResolveTimer(chat.id);
    }

    setLoadingStates((prev) => ({ ...prev, [chat.id]: false }));
  };

  const handleMessage = (
    chat: ChatConfig,
    sourceKey: string,
    sourceUrl: string,
    data: unknown,
    messageSourceUrl: unknown,
  ) => {
    if (configuredSourceKeysRef.current[chat.id] !== sourceKey) return;
    if (chat.platform !== "youtube") return;

    const activeSourceUrl = resolvedUrlsRef.current[chat.id] || sourceUrl;
    const redirectedChatUrl = getYouTubeChatUrlFromMessage(
      activeSourceUrl,
      data,
      messageSourceUrl,
    );
    if (!redirectedChatUrl) return;

    clearYouTubeResolveTimer(chat.id);
    resolvedUrlsRef.current[chat.id] = redirectedChatUrl;
    setResolvedUrls((prev) => ({
      ...prev,
      [chat.id]: redirectedChatUrl,
    }));
    setLoadingStates((prev) => ({ ...prev, [chat.id]: true }));
  };

  const handleNavigationRequest = (
    chat: ChatConfig,
    sourceKey: string,
    sourceUrl: string,
    url: string,
  ) => {
    if (configuredSourceKeysRef.current[chat.id] !== sourceKey) {
      return false;
    }

    if (chat.platform === "youtube") {
      const activeSourceUrl = resolvedUrlsRef.current[chat.id] || sourceUrl;
      const redirectedChatUrl = getYouTubeChatRedirect(activeSourceUrl, url);
      if (redirectedChatUrl) {
        clearYouTubeResolveTimer(chat.id);
        resolvedUrlsRef.current[chat.id] = redirectedChatUrl;
        setResolvedUrls((prev) => ({
          ...prev,
          [chat.id]: redirectedChatUrl,
        }));
        setLoadingStates((prev) => ({ ...prev, [chat.id]: true }));
        return false;
      }
      return isAllowedYouTubeChatNavigation(url, activeSourceUrl);
    }

    return isAllowedWebViewNavigation(url, sourceUrl, chat.platform);
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        <FlatList
          data={chats}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.tabBarContent}
          renderItem={({ item, index }) => (
            <TabItem
              chat={item}
              isActive={index === safeIndex}
              onPress={() => setActiveIndex(index)}
            />
          )}
        />
      </View>

      <View style={styles.chatContainer}>
        {chats.map((chat, index) => {
          const embedUrl = getMergedChatSourceUrl(chat);
          const sourceKey = `${chat.platform}:${embedUrl}`;
          const resolvedUrl =
            configuredSourceKeysRef.current[chat.id] ===
            sourceKey
              ? resolvedUrls[chat.id]
              : undefined;
          const sourceUrl = resolvedUrl || embedUrl;
          const kickChannel = chat.platform === "kick" ? getKickChannelName(chat.url) : null;
          const isVisible = index === safeIndex;

          if (Platform.OS !== "web" && !isVisible) {
            return null;
          }

          if (Platform.OS === "web") {
            return (
              <View
                key={chat.id}
                style={[styles.webViewWrapper, { display: isVisible ? "flex" : "none" } as any]}
              >
                {kickChannel ? (
                  <KickWebChat channel={kickChannel} fontSize={fontSize} />
                ) : (
                  <iframe
                    src={embedUrl}
                    style={{ width: "100%", height: "100%", border: "none", backgroundColor: themeColors.background } as any}
                    allow="autoplay"
                    sandbox={
                      chat.platform === "youtube"
                        ? "allow-scripts allow-same-origin allow-forms"
                        : "allow-scripts allow-same-origin allow-forms allow-popups"
                    }
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                )}
              </View>
            );
          }

          return (
            <View
              key={chat.id}
              style={[
                styles.webViewWrapper,
              ]}
              pointerEvents={isVisible ? "auto" : "none"}
            >
              {loadingStates[chat.id] && isVisible && (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="small" color={themeColors.primary} />
                  <Text style={styles.loadingText}>Loading {chat.name}...</Text>
                </View>
              )}
              <WebView
                key={sourceKey}
                ref={(ref) => { webViewRefs.current[chat.id] = ref; }}
                source={{ uri: sourceUrl }}
                style={styles.webview}
                onLoadStart={() => {
                  if (
                    configuredSourceKeysRef.current[chat.id] !==
                    sourceKey
                  ) {
                    return;
                  }
                  clearYouTubeResolveTimer(chat.id);
                  setLoadingStates((prev) => ({
                    ...prev,
                    [chat.id]: true,
                  }));
                }}
                onLoadEnd={({ nativeEvent }) =>
                  handleLoadEnd(
                    chat,
                    sourceKey,
                    sourceUrl,
                    nativeEvent.url || sourceUrl,
                  )
                }
                onMessage={({ nativeEvent }) =>
                  handleMessage(
                    chat,
                    sourceKey,
                    sourceUrl,
                    nativeEvent.data,
                    nativeEvent.url,
                  )
                }
                onError={() => {
                  if (
                    configuredSourceKeysRef.current[chat.id] !==
                    sourceKey
                  ) {
                    return;
                  }
                  clearYouTubeResolveTimer(chat.id);
                  setLoadingStates((prev) => ({
                    ...prev,
                    [chat.id]: false,
                  }));
                }}
                onShouldStartLoadWithRequest={({ url }) =>
                  handleNavigationRequest(
                    chat,
                    sourceKey,
                    sourceUrl,
                    url,
                  )
                }
                injectedJavaScript={injectedCSS}
                javaScriptEnabled
                domStorageEnabled
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                startInLoadingState={false}
                setSupportMultipleWindows={false}
                originWhitelist={getWebViewOriginWhitelist(
                  sourceUrl,
                  chat.platform,
                )}
                mixedContentMode="never"
              />
            </View>
          );
        })}
      </View>

      <View style={styles.indicator}>
        {chats.map((_, index) => (
          <View
            key={index}
            style={[styles.dot, index === safeIndex && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  tabBar: {
    backgroundColor: colors.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  tabBarContent: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  tabActive: {
    backgroundColor: colors.primary + "18",
    borderColor: colors.primary + "50",
  },
  tabText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: colors.textMuted,
    maxWidth: 100,
  },
  tabTextActive: {
    color: colors.primary,
    fontFamily: "Inter_600SemiBold",
  },
  chatContainer: {
    flex: 1,
    position: "relative",
  },
  webViewWrapper: {
    ...StyleSheet.absoluteFillObject,
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    gap: 8,
    zIndex: 10,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  indicator: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    backgroundColor: colors.surfaceElevated,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textMuted + "40",
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 16,
  },
});
