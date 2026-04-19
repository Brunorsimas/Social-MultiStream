import React, { useRef, useCallback, useMemo } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { ChatConfig, getChatEmbedUrl } from "@/lib/storage";
import { getScraperForPlatform } from "@/lib/chat-scrapers";
import { globalAggregator, UnifiedChatMessage } from "@/lib/message-aggregator";

interface HiddenChatCollectorProps {
  chat: ChatConfig;
  fontSize?: number;
}

const HiddenChatCollector = React.memo(function HiddenChatCollector({
  chat,
  fontSize = 14,
}: HiddenChatCollectorProps) {
  const webViewRef = useRef<WebView>(null);
  const embedUrl = getChatEmbedUrl(chat.url);

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
    return (
      <View style={styles.hiddenContainer}>
        <iframe
          src={embedUrl}
          style={{ width: 1, height: 1, border: "none", opacity: 0 } as any}
          allow="autoplay"
        />
      </View>
    );
  }

  return (
    <View style={styles.hiddenContainer}>
      <WebView
        ref={webViewRef}
        source={{ uri: embedUrl }}
        style={styles.hiddenWebView}
        onMessage={handleMessage}
        injectedJavaScript={injectedJS}
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
});
