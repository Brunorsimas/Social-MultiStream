import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform } from "react-native";
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

interface ChatWebViewProps {
  chat: ChatConfig;
  showHeader?: boolean;
  compact?: boolean;
  onPin?: () => void;
  fontSize?: number;
}

export default function ChatWebView({ chat, showHeader = true, compact = false, onPin, fontSize = 14 }: ChatWebViewProps) {
  const webViewRef = useRef<WebView>(null);
  const youtubeResolveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [webReloadKey, setWebReloadKey] = useState(0);
  const { themeColors } = useChats();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  const embedUrl = getChatEmbedUrl(chat.url, Platform.OS === "web" ? getCurrentEmbedDomain() : undefined);
  const [sourceUrl, setSourceUrl] = useState(embedUrl);
  const sourceUrlRef = useRef(embedUrl);

  const replaceSourceUrl = useCallback((nextUrl: string) => {
    sourceUrlRef.current = nextUrl;
    setSourceUrl(nextUrl);
  }, []);

  const clearYouTubeResolveTimer = useCallback(() => {
    if (!youtubeResolveTimerRef.current) return;
    clearTimeout(youtubeResolveTimerRef.current);
    youtubeResolveTimerRef.current = null;
  }, []);

  useEffect(() => {
    clearYouTubeResolveTimer();
    replaceSourceUrl(embedUrl);
    setLoading(true);
    setError(false);
  }, [clearYouTubeResolveTimer, embedUrl, replaceSourceUrl]);

  useEffect(
    () => () => clearYouTubeResolveTimer(),
    [clearYouTubeResolveTimer],
  );

  const handleNavigationRequest = ({ url }: { url: string }) => {
    if (chat.platform === "youtube") {
      const activeSourceUrl = sourceUrlRef.current;
      const redirectedChatUrl = getYouTubeChatRedirect(activeSourceUrl, url);
      if (redirectedChatUrl) {
        clearYouTubeResolveTimer();
        setLoading(true);
        setError(false);
        replaceSourceUrl(redirectedChatUrl);
        return false;
      }
      return isAllowedYouTubeChatNavigation(url, activeSourceUrl);
    }

    return isAllowedWebViewNavigation(url, sourceUrl, chat.platform);
  };

  const handleLoadEnd = ({ nativeEvent }: { nativeEvent: { url: string } }) => {
    if (chat.platform === "youtube") {
      const activeSourceUrl = sourceUrlRef.current;
      const finalUrl = nativeEvent.url || activeSourceUrl;
      if (shouldIgnoreYouTubeLoadEnd(activeSourceUrl, finalUrl)) return;

      const redirectedChatUrl = getYouTubeChatRedirect(
        activeSourceUrl,
        finalUrl,
      );
      if (redirectedChatUrl) {
        clearYouTubeResolveTimer();
        setLoading(true);
        setError(false);
        replaceSourceUrl(redirectedChatUrl);
        return;
      }
      if (!isYouTubeLiveChatUrl(finalUrl)) {
        clearYouTubeResolveTimer();
        setLoading(true);
        setError(false);
        webViewRef.current?.injectJavaScript(
          getYouTubeVideoIdExtractorScript(activeSourceUrl),
        );
        youtubeResolveTimerRef.current = setTimeout(() => {
          youtubeResolveTimerRef.current = null;
          if (!isYouTubeLiveChatUrl(sourceUrlRef.current)) {
            setError(true);
            setLoading(false);
          }
        }, YOUTUBE_VIDEO_ID_RESOLUTION_TIMEOUT_MS);
        return;
      }

      clearYouTubeResolveTimer();
      setError(false);
    }

    setLoading(false);
  };

  const handleMessage = useCallback(
    ({
      nativeEvent,
    }: {
      nativeEvent: { data?: string; url?: string };
    }) => {
      if (chat.platform !== "youtube") return;

      const redirectedChatUrl = getYouTubeChatUrlFromMessage(
        sourceUrlRef.current,
        nativeEvent.data,
        nativeEvent.url,
      );
      if (!redirectedChatUrl) return;

      clearYouTubeResolveTimer();
      setError(false);
      setLoading(true);
      replaceSourceUrl(redirectedChatUrl);
    },
    [
      chat.platform,
      clearYouTubeResolveTimer,
      replaceSourceUrl,
    ],
  );

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
              sandbox={
                chat.platform === "youtube"
                  ? "allow-scripts allow-same-origin allow-forms"
                  : "allow-scripts allow-same-origin allow-forms allow-popups"
              }
              referrerPolicy="strict-origin-when-cross-origin"
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
            key={`${chat.id}:${chat.platform}:${chat.url}`}
            ref={webViewRef}
            source={{ uri: sourceUrl }}
            style={styles.webview}
            onLoadStart={() => {
              clearYouTubeResolveTimer();
              setLoading(true);
            }}
            onLoadEnd={handleLoadEnd}
            onMessage={handleMessage}
            onError={() => {
              clearYouTubeResolveTimer();
              setError(true);
              setLoading(false);
            }}
            onShouldStartLoadWithRequest={handleNavigationRequest}
            injectedJavaScript={injectedCSS}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            startInLoadingState={false}
            setSupportMultipleWindows={false}
            originWhitelist={getWebViewOriginWhitelist(sourceUrl, chat.platform)}
            mixedContentMode="never"
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
