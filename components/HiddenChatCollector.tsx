import React, { useRef, useCallback, useMemo, useEffect } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { ChatConfig, getChatEmbedUrl } from "@/lib/storage";
import { getKickSocketInterceptor, getScraperForPlatform } from "@/lib/chat-scrapers";
import { globalAggregator, UnifiedChatMessage } from "@/lib/message-aggregator";
import { getApiUrl } from "@/lib/api-url";
import { getKickChannelName } from "@/lib/chat-url";

interface HiddenChatCollectorProps {
  chat: ChatConfig;
  fontSize?: number;
}

function useKickSSE(chat: ChatConfig) {
  useEffect(() => {
    if (Platform.OS !== "web" || chat.platform !== "kick") return;

    const channel = getKickChannelName(chat.url);
    if (!channel) return;

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
      try {
        const base = getApiUrl().replace(/\/$/, "");
        es = new EventSource(`${base}/api/kick/chat/${channel}`);

        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === "message" && data.message) {
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
                scheduleReconnect(3000);
              }
            } else if (data.type === "error") {
              es?.close();
            }
          } catch {}
        };

        es.onerror = () => {
          es?.close();
          if (active) {
            scheduleReconnect(5000);
          }
        };
      } catch {
        scheduleReconnect(5000);
      }
    }

    connect();

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [chat.id, chat.url, chat.platform, chat.name]);
}

const HiddenChatCollector = React.memo(function HiddenChatCollector({
  chat,
  fontSize = 14,
}: HiddenChatCollectorProps) {
  const webViewRef = useRef<WebView>(null);
  const embedUrl = getChatEmbedUrl(chat.url);
  const isKick = chat.platform === "kick";

  useKickSSE(chat);

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
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === "chat_messages" && Array.isArray(data.messages)) {
          const msgs: UnifiedChatMessage[] = data.messages
            .filter((m: any) => m.messageId && m.message)
            .map((m: any) => ({
              messageId: String(m.messageId),
              platform: m.platform || chat.platform,
              chatId: m.chatId || chat.id,
              chatName: m.chatName || chat.name,
              userName: m.userName || "Unknown",
              userAvatar: m.userAvatar || null,
              message: String(m.message),
              timestamp: m.timestamp || Date.now(),
            }));
          if (msgs.length > 0) {
            globalAggregator.addMessages(msgs);
          }
        }
      } catch (_) {}
    },
    [chat.id, chat.name, chat.platform]
  );

  if (Platform.OS === "web") {
    return <View style={styles.hiddenContainer} />;
  }

  return (
    <View
      collapsable={false}
      pointerEvents="none"
      style={isKick ? styles.kickCollectorContainer : styles.hiddenContainer}
    >
      <WebView
        ref={webViewRef}
        source={{ uri: embedUrl }}
        style={isKick ? styles.kickCollectorWebView : styles.hiddenWebView}
        onMessage={handleMessage}
        injectedJavaScriptBeforeContentLoaded={injectedBeforeLoad}
        injectedJavaScript={injectedJS}
        javaScriptEnabled
        domStorageEnabled
        {...(isKick ? {
          thirdPartyCookiesEnabled: true,
          sharedCookiesEnabled: true,
          setSupportMultipleWindows: false,
        } : {})}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        startInLoadingState={false}
        originWhitelist={["http://*", "https://*"]}
        mixedContentMode="compatibility"
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
  hiddenWebView: {
    width: 1,
    height: 1,
    opacity: 0,
  },
  kickCollectorContainer: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 420,
    height: 800,
    opacity: 0,
    overflow: "hidden",
  },
  kickCollectorWebView: {
    width: 420,
    height: 800,
  },
});
