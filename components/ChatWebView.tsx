import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { ThemeColors } from "@/constants/colors";
import PlatformBadge from "./PlatformBadge";
import KickWebChat from "./KickWebChat";
import { ChatConfig, getChatEmbedUrl } from "@/lib/storage";
import { getCurrentEmbedDomain, getKickChannelName } from "@/lib/chat-url";
import { useChats } from "@/lib/chat-context";

interface ChatWebViewProps {
  chat: ChatConfig;
  showHeader?: boolean;
  compact?: boolean;
  onPin?: () => void;
  fontSize?: number;
}

export default function ChatWebView({ chat, showHeader = true, compact = false, onPin, fontSize = 14 }: ChatWebViewProps) {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [webReloadKey, setWebReloadKey] = useState(0);
  const { themeColors } = useChats();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  const embedUrl = getChatEmbedUrl(chat.url, Platform.OS === "web" ? getCurrentEmbedDomain() : undefined);
  const [sourceUrl, setSourceUrl] = useState(embedUrl);

  useEffect(() => {
    setSourceUrl(embedUrl);
    setLoading(true);
    setError(false);
  }, [embedUrl]);

  const handleNavigationChange = ({ url }: { url: string }) => {
    if (chat.platform !== "youtube") return;
    const resolvedUrl = getChatEmbedUrl(url);
    if (resolvedUrl.includes("/live_chat?") && resolvedUrl !== sourceUrl) {
      setSourceUrl(resolvedUrl);
    }
  };

  const injectedCSS = `
    (function() {
      var style = document.createElement('style');
      style.textContent = 'body { font-size: ${fontSize}px !important; background: ${themeColors.background} !important; color: ${themeColors.text} !important; } * { font-size: inherit; }';
      document.head.appendChild(style);
    })();
    true;
  `;

  if (Platform.OS === "web") {
    const kickChannel = chat.platform === "kick" ? (getKickChannelName(chat.url) ?? "") : "";

    return (
      <View style={[styles.container, compact && styles.compact]}>
        {showHeader && (
          <View style={styles.header}>
            <PlatformBadge platform={chat.platform} size={12} />
            <Text style={styles.headerText} numberOfLines={1}>{chat.name}</Text>
            {onPin ? (
              <Pressable onPress={onPin} hitSlop={8}>
                <Ionicons name={chat.pinned ? "pin" : "pin-outline"} size={14} color={chat.pinned ? themeColors.warning : themeColors.textMuted} />
              </Pressable>
            ) : chat.pinned ? (
              <Ionicons name="pin" size={12} color={themeColors.warning} />
            ) : null}
            <Pressable onPress={() => setWebReloadKey((key) => key + 1)} hitSlop={8}>
              <Ionicons name="refresh" size={14} color={themeColors.textMuted} />
            </Pressable>
          </View>
        )}
        <View style={styles.webContainer}>
          {chat.platform === "kick" && kickChannel ? (
            <KickWebChat key={webReloadKey} channel={kickChannel} fontSize={fontSize} />
          ) : (
              <iframe
                key={webReloadKey}
              src={embedUrl}
              style={{ width: "100%", height: "100%", border: "none", backgroundColor: themeColors.background } as any}
              allow="autoplay"
            />
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, compact && styles.compact]}>
      {showHeader && (
        <View style={styles.header}>
          <PlatformBadge platform={chat.platform} size={12} />
          <Text style={styles.headerText} numberOfLines={1}>{chat.name}</Text>
          {onPin ? (
            <Pressable onPress={onPin} hitSlop={8}>
              <Ionicons name={chat.pinned ? "pin" : "pin-outline"} size={14} color={chat.pinned ? themeColors.warning : themeColors.textMuted} />
            </Pressable>
          ) : chat.pinned ? (
            <Ionicons name="pin" size={12} color={themeColors.warning} />
          ) : null}
          <Pressable onPress={() => webViewRef.current?.reload()} hitSlop={8}>
            <Ionicons name="refresh" size={14} color={themeColors.textMuted} />
          </Pressable>
        </View>
      )}
      <View style={styles.webContainer}>
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="small" color={themeColors.primary} />
            <Text style={styles.loadingText}>Loading chat...</Text>
          </View>
        )}
        {error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="cloud-offline" size={32} color={themeColors.textMuted} />
            <Text style={styles.errorText}>Unable to load chat</Text>
            <Pressable
              onPress={() => {
                setError(false);
                setLoading(true);
                webViewRef.current?.reload();
              }}
              style={styles.retryBtn}
            >
              <Ionicons name="refresh" size={16} color={themeColors.primary} />
            </Pressable>
          </View>
        ) : (
          <WebView
            ref={webViewRef}
            source={{ uri: sourceUrl }}
            style={styles.webview}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setError(true);
              setLoading(false);
            }}
            onNavigationStateChange={handleNavigationChange}
            injectedJavaScript={injectedCSS}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            startInLoadingState={false}
            originWhitelist={["http://*", "https://*"]}
            mixedContentMode="compatibility"
          />
        )}
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
  compact: {
    borderRadius: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  headerText: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  webContainer: {
    flex: 1,
    backgroundColor: colors.background,
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
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 20,
  },
  errorText: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  retryBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
});
