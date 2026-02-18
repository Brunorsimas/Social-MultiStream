import React, { useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform, FlatList } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import PlatformBadge from "./PlatformBadge";
import { ChatConfig, getChatEmbedUrl } from "@/lib/storage";

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
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, isActive && styles.tabActive]}
    >
      <PlatformBadge platform={chat.platform} size={12} />
      <Text style={[styles.tabText, isActive && styles.tabTextActive]} numberOfLines={1}>
        {chat.name}
      </Text>
      {chat.pinned && <Ionicons name="pin" size={10} color={Colors.dark.warning} />}
    </Pressable>
  );
}

export default function MergedChatView({ chats, fontSize = 14 }: MergedChatViewProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const webViewRefs = useRef<Record<string, WebView | null>>({});
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>(
    Object.fromEntries(chats.map((c) => [c.id, true]))
  );

  const activeChat = chats[activeIndex] || chats[0];

  if (!activeChat) return null;

  const injectedCSS = `
    (function() {
      var style = document.createElement('style');
      style.textContent = 'body { font-size: ${fontSize}px !important; background: #0A0A0F !important; } * { font-size: inherit; }';
      document.head.appendChild(style);
    })();
    true;
  `;

  const handleLoadEnd = (chatId: string) => {
    setLoadingStates((prev) => ({ ...prev, [chatId]: false }));
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
              isActive={index === activeIndex}
              onPress={() => setActiveIndex(index)}
            />
          )}
        />
      </View>

      <View style={styles.chatContainer}>
        {chats.map((chat, index) => {
          const embedUrl = getChatEmbedUrl(chat.url);
          const isVisible = index === activeIndex;

          if (Platform.OS === "web") {
            return (
              <View
                key={chat.id}
                style={[styles.webViewWrapper, { display: isVisible ? "flex" : "none" } as any]}
              >
                <iframe
                  src={embedUrl}
                  style={{ width: "100%", height: "100%", border: "none", backgroundColor: "#0A0A0F" } as any}
                  allow="autoplay"
                />
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
                  <ActivityIndicator size="small" color={Colors.dark.primary} />
                  <Text style={styles.loadingText}>Loading {chat.name}...</Text>
                </View>
              )}
              <WebView
                ref={(ref) => { webViewRefs.current[chat.id] = ref; }}
                source={{ uri: embedUrl }}
                style={styles.webview}
                onLoadEnd={() => handleLoadEnd(chat.id)}
                injectedJavaScript={injectedCSS}
                javaScriptEnabled
                domStorageEnabled
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                startInLoadingState={false}
                originWhitelist={["*"]}
                mixedContentMode="always"
              />
            </View>
          );
        })}
      </View>

      <View style={styles.indicator}>
        {chats.map((_, index) => (
          <View
            key={index}
            style={[styles.dot, index === activeIndex && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.dark.borderLight,
  },
  tabBar: {
    backgroundColor: Colors.dark.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.borderLight,
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
    backgroundColor: Colors.dark.background,
    borderWidth: 1,
    borderColor: Colors.dark.borderLight,
  },
  tabActive: {
    backgroundColor: Colors.dark.primary + "18",
    borderColor: Colors.dark.primary + "50",
  },
  tabText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.textMuted,
    maxWidth: 100,
  },
  tabTextActive: {
    color: Colors.dark.primary,
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
    backgroundColor: Colors.dark.background,
    gap: 8,
    zIndex: 10,
  },
  loadingText: {
    color: Colors.dark.textMuted,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  indicator: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    backgroundColor: Colors.dark.surfaceElevated,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.borderLight,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.dark.textMuted + "40",
  },
  dotActive: {
    backgroundColor: Colors.dark.primary,
    width: 16,
  },
});
