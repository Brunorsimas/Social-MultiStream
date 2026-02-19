import React, { useRef, useCallback } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { ChatConfig, getChatEmbedUrl } from "@/lib/storage";
import { getScraperForPlatform } from "@/lib/chat-scrapers";
import { globalAggregator, UnifiedChatMessage } from "@/lib/message-aggregator";

interface HiddenChatCollectorProps {
  chat: ChatConfig;
  fontSize?: number;
}

export default function HiddenChatCollector({ chat, fontSize = 14 }: HiddenChatCollectorProps) {
  const webViewRef = useRef<WebView>(null);
  const embedUrl = getChatEmbedUrl(chat.url);
  const scraperScript = getScraperForPlatform(chat.platform, chat.id, chat.name);

  const injectedJS = `
    (function() {
      var style = document.createElement('style');
      style.textContent = 'body { font-size: ${fontSize}px !important; background: #0A0A0F !important; } * { font-size: inherit; }';
      document.head.appendChild(style);
    })();
    ${scraperScript}
  `;

  const handleMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "chat_messages" && Array.isArray(data.messages)) {
        const msgs: UnifiedChatMessage[] = data.messages.map((m: any) => ({
          messageId: m.messageId || Date.now().toString() + Math.random().toString(36).substr(2, 9),
          platform: m.platform || chat.platform,
          chatId: m.chatId || chat.id,
          chatName: m.chatName || chat.name,
          userName: m.userName || "Unknown",
          userAvatar: m.userAvatar || null,
          message: m.message || "",
          timestamp: m.timestamp || Date.now(),
        }));
        globalAggregator.addMessages(msgs);
      }
    } catch (e) {
    }
  }, [chat.id, chat.name, chat.platform]);

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
}

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
