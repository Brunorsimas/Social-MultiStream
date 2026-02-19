import React, { useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform, Dimensions } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import PlatformBadge from "./PlatformBadge";
import { ChatConfig, getChatEmbedUrl } from "@/lib/storage";

interface UnifiedChatViewProps {
  chats: ChatConfig[];
  fontSize?: number;
}

interface UnifiedChatPanelProps {
  chat: ChatConfig;
  fontSize: number;
  height: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

function UnifiedChatPanel({ chat, fontSize, height, isCollapsed, onToggleCollapse }: UnifiedChatPanelProps) {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const embedUrl = getChatEmbedUrl(chat.url);
  const animatedHeight = useSharedValue(isCollapsed ? 40 : height);

  React.useEffect(() => {
    animatedHeight.value = withTiming(isCollapsed ? 40 : height, { duration: 250 });
  }, [isCollapsed, height]);

  const containerStyle = useAnimatedStyle(() => ({
    height: animatedHeight.value,
  }));

  const injectedCSS = `
    (function() {
      var style = document.createElement('style');
      style.textContent = 'body { font-size: ${fontSize}px !important; background: #0A0A0F !important; } * { font-size: inherit; }';
      document.head.appendChild(style);
    })();
    true;
  `;

  const platformColors: Record<string, string> = {
    twitch: Colors.dark.twitch,
    youtube: Colors.dark.youtube,
    kick: Colors.dark.kick,
    facebook: Colors.dark.facebook,
    tiktok: Colors.dark.tiktok,
    other: Colors.dark.primary,
  };

  const accentColor = platformColors[chat.platform] || Colors.dark.primary;

  return (
    <Animated.View style={[styles.panel, containerStyle, { borderLeftColor: accentColor }]}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onToggleCollapse();
        }}
        style={styles.panelHeader}
      >
        <PlatformBadge platform={chat.platform} size={12} />
        <Text style={styles.panelName} numberOfLines={1}>{chat.name}</Text>
        {chat.pinned && <Ionicons name="pin" size={11} color={Colors.dark.warning} />}
        <View style={styles.panelSpacer} />
        <Pressable
          onPress={() => {
            webViewRef.current?.reload();
          }}
          hitSlop={8}
          style={styles.panelAction}
        >
          <Ionicons name="refresh" size={13} color={Colors.dark.textMuted} />
        </Pressable>
        <Ionicons
          name={isCollapsed ? "chevron-down" : "chevron-up"}
          size={14}
          color={Colors.dark.textMuted}
        />
      </Pressable>

      {!isCollapsed && (
        <View style={styles.panelContent}>
          {loading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="small" color={accentColor} />
              <Text style={styles.loadingText}>Loading {chat.name}...</Text>
            </View>
          )}
          {error ? (
            <View style={styles.errorContainer}>
              <Ionicons name="cloud-offline" size={24} color={Colors.dark.textMuted} />
              <Text style={styles.errorText}>Unable to load</Text>
              <Pressable
                onPress={() => {
                  setError(false);
                  setLoading(true);
                  webViewRef.current?.reload();
                }}
                style={styles.retryBtn}
              >
                <Ionicons name="refresh" size={14} color={accentColor} />
              </Pressable>
            </View>
          ) : Platform.OS === "web" ? (
            <iframe
              src={embedUrl}
              style={{ width: "100%", height: "100%", border: "none", backgroundColor: "#0A0A0F" } as any}
              allow="autoplay"
            />
          ) : (
            <WebView
              ref={webViewRef}
              source={{ uri: embedUrl }}
              style={styles.webview}
              onLoadEnd={() => setLoading(false)}
              onError={() => { setError(true); setLoading(false); }}
              injectedJavaScript={injectedCSS}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              startInLoadingState={false}
              originWhitelist={["*"]}
              mixedContentMode="always"
            />
          )}
        </View>
      )}
    </Animated.View>
  );
}

export default function UnifiedChatView({ chats, fontSize = 14 }: UnifiedChatViewProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const screenHeight = Dimensions.get("window").height;

  const expandedCount = chats.filter((c) => !collapsedIds.has(c.id)).length;
  const collapsedCount = chats.length - expandedCount;
  const availableHeight = screenHeight - 120 - (collapsedCount * 40);
  const panelHeight = expandedCount > 0 ? Math.max(150, availableHeight / expandedCount) : 200;

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const collapseAll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (collapsedIds.size === chats.length) {
      setCollapsedIds(new Set());
    } else {
      setCollapsedIds(new Set(chats.map((c) => c.id)));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.unifiedHeader}>
        <Ionicons name="layers" size={16} color={Colors.dark.primary} />
        <Text style={styles.unifiedTitle}>Unified View</Text>
        <Text style={styles.unifiedCount}>{chats.length} chats</Text>
        <View style={styles.panelSpacer} />
        <Pressable onPress={collapseAll} hitSlop={8} style={styles.collapseAllBtn}>
          <Ionicons
            name={collapsedIds.size === chats.length ? "expand" : "contract"}
            size={16}
            color={Colors.dark.textSecondary}
          />
        </Pressable>
      </View>
      <View style={styles.panelsList}>
        {chats.map((chat) => (
          <UnifiedChatPanel
            key={chat.id}
            chat={chat}
            fontSize={fontSize}
            height={panelHeight}
            isCollapsed={collapsedIds.has(chat.id)}
            onToggleCollapse={() => toggleCollapse(chat.id)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  unifiedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.dark.surfaceElevated,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.dark.borderLight,
  },
  unifiedTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  unifiedCount: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
    backgroundColor: Colors.dark.background,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  collapseAllBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  panelsList: {
    flex: 1,
    gap: 4,
  },
  panel: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.dark.borderLight,
    borderLeftWidth: 3,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Colors.dark.surfaceElevated,
    minHeight: 38,
  },
  panelName: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    maxWidth: 150,
  },
  panelSpacer: {
    flex: 1,
  },
  panelAction: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  panelContent: {
    flex: 1,
    backgroundColor: Colors.dark.background,
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
    gap: 6,
    zIndex: 10,
  },
  loadingText: {
    color: Colors.dark.textMuted,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  errorText: {
    color: Colors.dark.textMuted,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  retryBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.dark.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
});
