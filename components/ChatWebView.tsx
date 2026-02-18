import React, { useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import PlatformBadge from "./PlatformBadge";
import { ChatConfig, getChatEmbedUrl } from "@/lib/storage";

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

  const embedUrl = getChatEmbedUrl(chat.url);

  const injectedCSS = `
    (function() {
      var style = document.createElement('style');
      style.textContent = 'body { font-size: ${fontSize}px !important; background: #0A0A0F !important; } * { font-size: inherit; }';
      document.head.appendChild(style);
    })();
    true;
  `;

  if (Platform.OS === "web") {
    return (
      <View style={[styles.container, compact && styles.compact]}>
        {showHeader && (
          <View style={styles.header}>
            <PlatformBadge platform={chat.platform} size={12} />
            <Text style={styles.headerText} numberOfLines={1}>{chat.name}</Text>
            {chat.pinned && <Ionicons name="pin" size={12} color={Colors.dark.warning} />}
          </View>
        )}
        <View style={styles.webContainer}>
          <iframe
            src={embedUrl}
            style={{ width: "100%", height: "100%", border: "none", backgroundColor: "#0A0A0F" } as any}
            allow="autoplay"
          />
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
          {chat.pinned && <Ionicons name="pin" size={12} color={Colors.dark.warning} />}
          {onPin && (
            <Pressable onPress={onPin} hitSlop={8}>
              <Ionicons name={chat.pinned ? "pin" : "pin-outline"} size={14} color={Colors.dark.textMuted} />
            </Pressable>
          )}
          <Pressable onPress={() => webViewRef.current?.reload()} hitSlop={8}>
            <Ionicons name="refresh" size={14} color={Colors.dark.textMuted} />
          </Pressable>
        </View>
      )}
      <View style={styles.webContainer}>
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="small" color={Colors.dark.primary} />
            <Text style={styles.loadingText}>Loading chat...</Text>
          </View>
        )}
        {error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="cloud-offline" size={32} color={Colors.dark.textMuted} />
            <Text style={styles.errorText}>Unable to load chat</Text>
            <Pressable
              onPress={() => {
                setError(false);
                setLoading(true);
                webViewRef.current?.reload();
              }}
              style={styles.retryBtn}
            >
              <Ionicons name="refresh" size={16} color={Colors.dark.primary} />
            </Pressable>
          </View>
        ) : (
          <WebView
            ref={webViewRef}
            source={{ uri: embedUrl }}
            style={styles.webview}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setError(true);
              setLoading(false);
            }}
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
  compact: {
    borderRadius: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Colors.dark.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.borderLight,
  },
  headerText: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  webContainer: {
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
    gap: 8,
    zIndex: 10,
  },
  loadingText: {
    color: Colors.dark.textMuted,
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
    color: Colors.dark.textMuted,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  retryBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
});
