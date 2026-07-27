import React, { useRef, useCallback, useMemo, useEffect } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { ChatConfig, getChatEmbedUrl } from "@/lib/storage";
import { getKickSocketInterceptor, getScraperForPlatform } from "@/lib/chat-scrapers";
import { globalAggregator } from "@/lib/message-aggregator";
import { getApiUrl } from "@/lib/api-url";
import { getKickChannelName } from "@/lib/chat-url";
import {
  getWebViewOriginWhitelist,
  isAllowedWebViewNavigation,
  normalizeCollectorEvent,
  shouldShareWebViewCookies,
} from "@/lib/webview-security";

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

function useKickSSE(
  chat: ChatConfig,
  onStatusChange?: HiddenChatCollectorProps["onStatusChange"],
) {
  useEffect(() => {
    if (Platform.OS !== "web" || chat.platform !== "kick") return;

    const channel = getKickChannelName(chat.url);
    if (!channel) {
      onStatusChange?.(chat.id, "error", "Invalid Kick channel");
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
        es = new EventSource(`${base}/api/kick/chat/${channel}`);

        es.onopen = () => {
          if (active) onStatusChange?.(chat.id, "connected");
        };

        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === "message" && data.message) {
              onStatusChange?.(chat.id, "receiving");
              globalAggregator.addMessage({
                messageId: `${chat.id}_kk_${data.messageId}`,
                platform: "kick",
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
                  : "Kick chat unavailable",
              );
              scheduleReconnect(15_000);
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
  const embedUrl = getChatEmbedUrl(chat.url);
  const isKick = chat.platform === "kick";
  const shareCookies = shouldShareWebViewCookies(embedUrl, chat.platform);

  useKickSSE(chat, onStatusChange);

  useEffect(() => {
    if (Platform.OS === "web" && chat.platform !== "kick") {
      onStatusChange?.(
        chat.id,
        "unsupported",
        "Web collection is currently available for Kick",
      );
    }
  }, [chat.id, chat.platform, onStatusChange]);

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
      const messages = normalizeCollectorEvent(
        event?.nativeEvent?.data,
        embedUrl,
        event?.nativeEvent?.url,
        chat,
      );
      if (messages.length > 0) {
        onStatusChange?.(chat.id, "receiving");
        globalAggregator.addMessages(messages);
      }
    },
    [chat, embedUrl, onStatusChange]
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
        ref={webViewRef}
        source={{ uri: embedUrl }}
        style={styles.collectorWebView}
        onMessage={handleMessage}
        onLoadStart={() => {
          loadHadErrorRef.current = false;
          onStatusChange?.(chat.id, "connecting");
        }}
        onLoadEnd={() => {
          if (!loadHadErrorRef.current) {
            onStatusChange?.(chat.id, "connected");
          }
        }}
        onError={() => {
          loadHadErrorRef.current = true;
          onStatusChange?.(chat.id, "error", "Unable to load chat")
        }}
        onHttpError={({ nativeEvent }) => {
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
        {...(isKick ? {
          setSupportMultipleWindows: false,
        } : {})}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        startInLoadingState={false}
        originWhitelist={getWebViewOriginWhitelist(embedUrl, chat.platform)}
        onShouldStartLoadWithRequest={({ url }) =>
          isAllowedWebViewNavigation(url, embedUrl, chat.platform)
        }
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
    left: 0,
    top: 0,
    width: 420,
    height: 800,
    opacity: 0.01,
    overflow: "hidden",
  },
  collectorWebView: {
    width: 420,
    height: 800,
  },
});
