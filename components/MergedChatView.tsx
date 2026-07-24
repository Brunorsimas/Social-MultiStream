import React, { useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform, FlatList } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { ThemeColors } from "@/constants/colors";
import PlatformBadge from "./PlatformBadge";
import KickWebChat from "./KickWebChat";
import { ChatConfig, getChatEmbedUrl } from "@/lib/storage";
import { getCurrentEmbedDomain, getKickChannelName } from "@/lib/chat-url";
import { useChats } from "@/lib/chat-context";
import {
  getWebViewOriginWhitelist,
  isAllowedWebViewNavigation,
} from "@/lib/webview-security";

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

export default function MergedChatView({ chats, fontSize = 14 }: MergedChatViewProps) {
  const { themeColors } = useChats();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [activeIndex, setActiveIndex] = useState(0);
  const webViewRefs = useRef<Record<string, WebView | null>>({});
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>(
    Object.fromEntries(chats.map((c) => [c.id, true]))
  );
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});

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

  const handleLoadEnd = (chatId: string) => {
    setLoadingStates((prev) => ({ ...prev, [chatId]: false }));
  };

  const handleNavigationChange = (chat: ChatConfig, url: string) => {
    if (chat.platform !== "youtube") return;
    const resolvedUrl = getChatEmbedUrl(url);
    if (resolvedUrl.includes("/live_chat?") && resolvedUrls[chat.id] !== resolvedUrl) {
      setResolvedUrls((prev) => ({ ...prev, [chat.id]: resolvedUrl }));
    }
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
          const embedUrl = getChatEmbedUrl(chat.url, Platform.OS === "web" ? getCurrentEmbedDomain() : undefined);
          const kickChannel = chat.platform === "kick" ? getKickChannelName(chat.url) : null;
          const isVisible = index === safeIndex;

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
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
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
                !isVisible && styles.hiddenView,
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
                ref={(ref) => { webViewRefs.current[chat.id] = ref; }}
                source={{ uri: resolvedUrls[chat.id] || embedUrl }}
                style={styles.webview}
                onLoadEnd={() => handleLoadEnd(chat.id)}
                onNavigationStateChange={({ url }) => handleNavigationChange(chat, url)}
                onShouldStartLoadWithRequest={({ url }) =>
                  isAllowedWebViewNavigation(
                    url,
                    resolvedUrls[chat.id] || embedUrl,
                    chat.platform,
                  )
                }
                injectedJavaScript={injectedCSS}
                javaScriptEnabled
                domStorageEnabled
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                startInLoadingState={false}
                originWhitelist={getWebViewOriginWhitelist(
                  resolvedUrls[chat.id] || embedUrl,
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
  hiddenView: {
    opacity: 0,
    zIndex: -1,
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
