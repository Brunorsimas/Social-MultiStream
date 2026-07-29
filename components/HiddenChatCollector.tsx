import React, {
  useRef,
  useCallback,
  useMemo,
  useEffect,
  useState,
} from "react";
import { View, StyleSheet, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { ChatConfig, getChatEmbedUrl } from "@/lib/storage";
import { getKickSocketInterceptor, getScraperForPlatform } from "@/lib/chat-scrapers";
import { globalAggregator } from "@/lib/message-aggregator";
import { getApiUrl } from "@/lib/api-url";
import {
  getWebChatEndpoint,
  shouldRetryWebChatError,
} from "@/lib/web-chat-endpoint";
import {
  getYouTubeChatRedirect,
  isAllowedYouTubeChatNavigation,
  isYouTubeLiveChatUrl,
  shouldIgnoreYouTubeLoadEnd,
} from "@/lib/chat-url";
import {
  getWebViewOriginWhitelist,
  isAllowedWebViewNavigation,
  normalizeCollectorEvent,
  shouldShareWebViewCookies,
} from "@/lib/webview-security";
import {
  getYouTubeChatUrlFromMessage,
  getYouTubeVideoIdExtractorScript,
  YOUTUBE_VIDEO_ID_RESOLUTION_TIMEOUT_MS,
} from "@/lib/youtube-webview";

interface HiddenChatCollectorProps {
  chat: ChatConfig;
  fontSize?: number;
  onStatusChange?: (
    chatId: string,
    status: CollectorStatus,
    detail?: string,
  ) => void;
}

export type CollectorStatus =
  | "connecting"
  | "connected"
  | "receiving"
  | "unsupported"
  | "error";

function useWebChatSSE(
  chat: ChatConfig,
  onStatusChange?: HiddenChatCollectorProps["onStatusChange"],
) {
  useEffect(() => {
    if (Platform.OS !== "web") return;

    const endpoint = getWebChatEndpoint({
      platform: chat.platform,
      url: chat.url,
    });
    if (!endpoint) {
      onStatusChange?.(
        chat.id,
        "unsupported",
        "This platform requires an official chat API integration on the web",
      );
      return;
    }

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const scheduleReconnect = (delay: number) => {
      if (!active) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    };

    function connect() {
      if (!active) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      es?.close();
      onStatusChange?.(chat.id, "connecting");
      try {
        const base = getApiUrl().replace(/\/$/, "");
        es = new EventSource(`${base}${endpoint}`);

        es.onopen = () => {
          if (active) {
            onStatusChange?.(
              chat.id,
              "connecting",
              "Waiting for the platform",
            );
          }
        };

        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === "message" && data.message) {
              onStatusChange?.(chat.id, "receiving");
              const platform =
                chat.platform === "kick" ||
                chat.platform === "twitch" ||
                chat.platform === "youtube"
                  ? chat.platform
                  : "unknown";
              globalAggregator.addMessage({
                messageId: `${chat.id}_${platform}_${data.messageId}`,
                platform,
                chatId: chat.id,
                chatName: chat.name,
                userName: data.userName || "Unknown",
                userAvatar: typeof data.userAvatar === "string" ? data.userAvatar : null,
                message: String(data.message),
                timestamp: data.timestamp || Date.now(),
              });
            } else if (data.type === "disconnected") {
              es?.close();
              if (active) {
                onStatusChange?.(chat.id, "connecting", "Reconnecting");
                scheduleReconnect(3000);
              }
            } else if (data.type === "error") {
              es?.close();
              onStatusChange?.(
                chat.id,
                "error",
                typeof data.message === "string"
                  ? data.message
                  : "Chat unavailable",
              );
              if (shouldRetryWebChatError(data)) {
                scheduleReconnect(15_000);
              }
            } else if (
              data.type === "connected" ||
              data.type === "subscribed"
            ) {
              onStatusChange?.(chat.id, "connected");
            }
          } catch {}
        };

        es.onerror = () => {
          es?.close();
          if (active) {
            onStatusChange?.(chat.id, "error", "Connection interrupted");
            scheduleReconnect(5000);
          }
        };
      } catch {
        onStatusChange?.(chat.id, "error", "Unable to open connection");
        scheduleReconnect(5000);
      }
    }

    connect();

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [
    chat.id,
    chat.url,
    chat.platform,
    chat.name,
    onStatusChange,
  ]);
}

const HiddenChatCollector = React.memo(function HiddenChatCollector({
  chat,
  fontSize = 14,
  onStatusChange,
}: HiddenChatCollectorProps) {
  const webViewRef = useRef<WebView>(null);
  const loadHadErrorRef = useRef(false);
  const ytResolveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const embedUrl = getChatEmbedUrl(chat.url);
  const [sourceUrl, setSourceUrl] = useState(embedUrl);
  const sourceUrlRef = useRef(embedUrl);
  const isKick = chat.platform === "kick";
  const shareCookies = shouldShareWebViewCookies(sourceUrl, chat.platform);

  useWebChatSSE(chat, onStatusChange);

  const clearYouTubeResolveTimer = useCallback(() => {
    if (!ytResolveTimerRef.current) return;
    clearTimeout(ytResolveTimerRef.current);
    ytResolveTimerRef.current = null;
  }, []);

  useEffect(() => {
    clearYouTubeResolveTimer();
    sourceUrlRef.current = embedUrl;
    setSourceUrl(embedUrl);
  }, [clearYouTubeResolveTimer, embedUrl]);

  useEffect(
    () => () => clearYouTubeResolveTimer(),
    [clearYouTubeResolveTimer],
  );

  const replaceSourceUrl = useCallback((nextUrl: string) => {
    sourceUrlRef.current = nextUrl;
    setSourceUrl(nextUrl);
  }, []);

  const injectedJS = useMemo(() => {
    const scraperScript = getScraperForPlatform(chat.platform, chat.id, chat.name);
    return `
      (function() {
        var style = document.createElement('style');
        style.textContent = 'body { font-size: ${fontSize}px !important; background: #0A0A0F !important; } * { font-size: inherit; }';
        document.head.appendChild(style);
      })();
      ${scraperScript}
    `;
  }, [chat.id, chat.name, chat.platform, fontSize]);

  const injectedBeforeLoad = useMemo(
    () => isKick ? getKickSocketInterceptor(chat.id, chat.name) : undefined,
    [chat.id, chat.name, isKick],
  );

  const handleMessage = useCallback(
    (event: any) => {
      const rawData = event?.nativeEvent?.data;

      if (chat.platform === "youtube") {
        const redirectedChatUrl = getYouTubeChatUrlFromMessage(
          sourceUrlRef.current,
          rawData,
          event?.nativeEvent?.url,
        );
        if (redirectedChatUrl) {
          clearYouTubeResolveTimer();
          replaceSourceUrl(redirectedChatUrl);
          onStatusChange?.(chat.id, "connecting", "Opening the live chat");
          return;
        }
      }

      const messages = normalizeCollectorEvent(
        rawData,
        sourceUrlRef.current,
        event?.nativeEvent?.url,
        chat,
      );
      if (messages.length > 0) {
        onStatusChange?.(chat.id, "receiving");
        globalAggregator.addMessages(messages);
      }
    },
    [
      chat,
      clearYouTubeResolveTimer,
      onStatusChange,
      replaceSourceUrl,
    ],
  );

  const handleNavigationRequest = useCallback(
    ({ url }: { url: string }) => {
      if (chat.platform === "youtube") {
        const activeSourceUrl = sourceUrlRef.current;
        const redirectedChatUrl = getYouTubeChatRedirect(activeSourceUrl, url);
        if (redirectedChatUrl) {
          clearYouTubeResolveTimer();
          replaceSourceUrl(redirectedChatUrl);
          return false;
        }
        return isAllowedYouTubeChatNavigation(url, activeSourceUrl);
      }

      return isAllowedWebViewNavigation(url, sourceUrl, chat.platform);
    },
    [
      chat.platform,
      clearYouTubeResolveTimer,
      replaceSourceUrl,
      sourceUrl,
    ],
  );

  if (Platform.OS === "web") {
    return <View style={styles.hiddenContainer} />;
  }

  return (
    <View
      collapsable={false}
      pointerEvents="none"
      style={styles.collectorContainer}
    >
      <WebView
        key={`${chat.id}:${chat.platform}:${chat.url}`}
        ref={webViewRef}
        source={{ uri: sourceUrl }}
        style={styles.collectorWebView}
        onMessage={handleMessage}
        onLoadStart={() => {
          clearYouTubeResolveTimer();
          loadHadErrorRef.current = false;
          onStatusChange?.(chat.id, "connecting");
        }}
        onLoadEnd={({ nativeEvent }) => {
          if (loadHadErrorRef.current) return;

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
              replaceSourceUrl(redirectedChatUrl);
              onStatusChange?.(
                chat.id,
                "connecting",
                "Opening the live chat",
              );
              return;
            }
            if (!isYouTubeLiveChatUrl(finalUrl)) {
              // The loaded page is not the live_chat iframe (e.g. a @handle/live
              // page). Inject a script to extract the videoId from the HTML so
              // we can redirect to the correct live_chat URL.
              onStatusChange?.(
                chat.id,
                "connecting",
                "Resolving live stream",
              );
              clearYouTubeResolveTimer();
              ytResolveTimerRef.current = setTimeout(() => {
                ytResolveTimerRef.current = null;
                if (!isYouTubeLiveChatUrl(sourceUrlRef.current)) {
                  onStatusChange?.(
                    chat.id,
                    "error",
                    "No active YouTube live chat was found for this channel",
                  );
                }
              }, YOUTUBE_VIDEO_ID_RESOLUTION_TIMEOUT_MS);
              webViewRef.current?.injectJavaScript(
                getYouTubeVideoIdExtractorScript(activeSourceUrl),
              );
              return;
            }

            clearYouTubeResolveTimer();
          }

          onStatusChange?.(chat.id, "connected");
        }}
        onError={() => {
          clearYouTubeResolveTimer();
          loadHadErrorRef.current = true;
          onStatusChange?.(chat.id, "error", "Unable to load chat")
        }}
        onHttpError={({ nativeEvent }) => {
          clearYouTubeResolveTimer();
          loadHadErrorRef.current = true;
          onStatusChange?.(
            chat.id,
            "error",
            `Chat returned HTTP ${nativeEvent.statusCode}`,
          )
        }}
        injectedJavaScriptBeforeContentLoaded={injectedBeforeLoad}
        injectedJavaScript={injectedJS}
        javaScriptEnabled
        domStorageEnabled
        {...(shareCookies ? {
          thirdPartyCookiesEnabled: true,
          sharedCookiesEnabled: true,
        } : {})}
        setSupportMultipleWindows={false}
        androidLayerType="software"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        startInLoadingState={false}
        originWhitelist={getWebViewOriginWhitelist(sourceUrl, chat.platform)}
        onShouldStartLoadWithRequest={handleNavigationRequest}
        mixedContentMode="never"
      />
    </View>
  );
});

export default HiddenChatCollector;

const styles = StyleSheet.create({
  hiddenContainer: {
    width: 0,
    height: 0,
    overflow: "hidden",
    position: "absolute",
    opacity: 0,
  },
  collectorContainer: {
    position: "absolute",
    left: -10_000,
    top: -10_000,
    width: 420,
    height: 800,
    overflow: "hidden",
    zIndex: -1,
  },
  collectorWebView: {
    width: 420,
    height: 800,
  },
});
