import React, { useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import PlatformBadge from "@/components/PlatformBadge";

const PLATFORM_LOGIN_URLS: Record<string, { url: string; label: string }> = {
  twitch: { url: "https://www.twitch.tv/login", label: "Twitch" },
  youtube: { url: "https://accounts.google.com/signin/v2/identifier?service=youtube", label: "YouTube" },
  kick: { url: "https://kick.com/", label: "Kick" },
  facebook: { url: "https://www.facebook.com/login", label: "Facebook" },
  tiktok: { url: "https://www.tiktok.com/login", label: "TikTok" },
  other: { url: "", label: "Platform" },
};

export default function PlatformLoginScreen() {
  const insets = useSafeAreaInsets();
  const { platform, chatUrl } = useLocalSearchParams<{ platform: string; chatUrl?: string }>();
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const platformInfo = PLATFORM_LOGIN_URLS[platform || "other"] || PLATFORM_LOGIN_URLS.other;
  const loginUrl = platformInfo.url || chatUrl || "";

  const handleSkip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.dismiss();
    router.dismiss();
  };

  const handleDone = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.dismiss();
    router.dismiss();
  };

  if (Platform.OS === "web" || !loginUrl) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + webTopInset + 12 }]}>
          <View style={{ width: 24 }} />
          <Text style={styles.headerTitle}>Platform Login</Text>
          <Pressable onPress={handleSkip} hitSlop={12}>
            <Ionicons name="close" size={24} color={Colors.dark.textSecondary} />
          </Pressable>
        </View>
        <View style={styles.webFallback}>
          <PlatformBadge platform={platform || "other"} size={28} />
          <Text style={styles.fallbackTitle}>Login on {platformInfo.label}</Text>
          <Text style={styles.fallbackDesc}>
            Open {platformInfo.label} in your browser and sign in to enable chat functionality.
          </Text>
          <Pressable onPress={handleSkip} style={({ pressed }) => [styles.skipBtn, pressed && { opacity: 0.8 }]}>
            <Text style={styles.skipBtnText}>Continue</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + webTopInset + 12 }]}>
        <Pressable onPress={handleSkip} hitSlop={12}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <PlatformBadge platform={platform || "other"} size={14} />
          <Text style={styles.headerTitle}>Login to {platformInfo.label}</Text>
        </View>
        <Pressable onPress={handleDone} hitSlop={12}>
          <Ionicons name="checkmark" size={26} color={Colors.dark.success} />
        </Pressable>
      </View>

      <View style={styles.infoBar}>
        <Ionicons name="lock-closed" size={13} color={Colors.dark.textMuted} />
        <Text style={styles.infoText}>
          Sign in so your chat loads correctly. Your credentials are stored only in the browser.
        </Text>
      </View>

      <View style={styles.webContainer}>
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={Colors.dark.primary} />
            <Text style={styles.loadingText}>Loading {platformInfo.label}...</Text>
          </View>
        )}
        <WebView
          ref={webViewRef}
          source={{ uri: loginUrl }}
          style={styles.webview}
          onLoadEnd={() => setLoading(false)}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          startInLoadingState={false}
          originWhitelist={["*"]}
          mixedContentMode="always"
          userAgent="Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.borderLight,
  },
  headerCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  skipText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.textSecondary,
  },
  infoBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.dark.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.borderLight,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
    lineHeight: 16,
  },
  webContainer: {
    flex: 1,
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
    gap: 12,
    zIndex: 10,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
  },
  webFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  fallbackTitle: {
    fontSize: 20,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginTop: 4,
  },
  fallbackDesc: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  skipBtn: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
    marginTop: 8,
  },
  skipBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.background,
  },
});
