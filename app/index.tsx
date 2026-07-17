import React from "react";
import { View, Text, Pressable, StyleSheet, Platform, StatusBar } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useChats } from "@/lib/chat-context";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { chats, activeChats, settings, updateSettings, themeColors } = useChats();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;
  const isDark = settings.theme === "dark";

  const navigate = (path: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(path as any);
  };

  const toggleTheme = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void updateSettings({ theme: isDark ? "light" : "dark" });
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <View style={[styles.content, { paddingTop: insets.top + webTopInset + 20, paddingBottom: insets.bottom + webBottomInset + 20 }]}>
        {/* Theme toggle in top-right */}
        <View style={styles.themeToggleRow}>
          <Pressable
            onPress={toggleTheme}
            style={[styles.themeToggleBtn, { backgroundColor: themeColors.surface, borderColor: themeColors.borderLight }]}
          >
            <Ionicons
              name={isDark ? "sunny" : "moon"}
              size={18}
              color={isDark ? themeColors.warning : themeColors.secondary}
            />
          </Pressable>
        </View>

        <View style={styles.heroSection}>
          <View style={styles.logoRow}>
            <View style={[styles.logoIcon, { backgroundColor: themeColors.primary + "15", borderColor: themeColors.primary + "30" }]}>
              <MaterialCommunityIcons name="message-flash" size={28} color={themeColors.primary} />
            </View>
          </View>
          <Text style={[styles.title, { color: themeColors.text }]}>StreamChat</Text>
          <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>All your live chats in one place</Text>
        </View>

        <View style={[styles.statsRow, { backgroundColor: themeColors.surface, borderColor: themeColors.borderLight }]}>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: themeColors.text }]}>{chats.length}</Text>
            <Text style={[styles.statLabel, { color: themeColors.textMuted }]}>Total</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: themeColors.border }]} />
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: themeColors.success }]}>{activeChats.length}</Text>
            <Text style={[styles.statLabel, { color: themeColors.textMuted }]}>Active</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: themeColors.border }]} />
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: themeColors.warning }]}>{chats.filter(c => c.pinned).length}</Text>
            <Text style={[styles.statLabel, { color: themeColors.textMuted }]}>Pinned</Text>
          </View>
        </View>

        <Pressable
          onPress={() => navigate("/multichat")}
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
        >
          <LinearGradient
            colors={[themeColors.primary, themeColors.primaryDim]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.primaryGradient}
          >
            <MaterialCommunityIcons name="view-grid" size={22} color={isDark ? "#000" : "#FFF"} />
            <Text style={[styles.primaryBtnText, { color: isDark ? "#000" : "#FFF" }]}>Open MultiChat</Text>
          </LinearGradient>
        </Pressable>

        <View style={styles.actionsGrid}>
          <Pressable
            onPress={() => navigate("/add-chat")}
            style={({ pressed }) => [styles.actionCard, { backgroundColor: themeColors.surface, borderColor: themeColors.borderLight }, pressed && styles.actionPressed]}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: themeColors.secondary + "20" }]}>
              <Ionicons name="add-circle" size={24} color={themeColors.secondary} />
            </View>
            <Text style={[styles.actionTitle, { color: themeColors.text }]}>Add Chat</Text>
            <Text style={[styles.actionDesc, { color: themeColors.textMuted }]}>Register a new stream chat</Text>
          </Pressable>

          <Pressable
            onPress={() => navigate("/manage")}
            style={({ pressed }) => [styles.actionCard, { backgroundColor: themeColors.surface, borderColor: themeColors.borderLight }, pressed && styles.actionPressed]}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: themeColors.primary + "20" }]}>
              <Ionicons name="settings-sharp" size={24} color={themeColors.primary} />
            </View>
            <Text style={[styles.actionTitle, { color: themeColors.text }]}>Manage</Text>
            <Text style={[styles.actionDesc, { color: themeColors.textMuted }]}>Edit, reorder & configure</Text>
          </Pressable>
        </View>

        <View style={styles.quickTip}>
          <Ionicons name="information-circle" size={16} color={themeColors.textMuted} />
          <Text style={[styles.tipText, { color: themeColors.textMuted }]}>
            Add chat URLs from Twitch, YouTube, Kick or any platform
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  themeToggleRow: {
    position: "absolute",
    top: 0,
    right: 0,
    zIndex: 10,
    paddingRight: 20,
    paddingTop: 4,
  },
  themeToggleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  heroSection: {
    alignItems: "center",
    marginBottom: 32,
  },
  logoRow: {
    marginBottom: 16,
  },
  logoIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  title: {
    fontSize: 32,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  statsRow: {
    flexDirection: "row",
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    alignItems: "center",
  },
  statCard: {
    flex: 1,
    alignItems: "center",
  },
  statNumber: {
    fontSize: 24,
    fontFamily: "Inter_600SemiBold",
  },
  statLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
  },
  primaryBtn: {
    marginBottom: 16,
    borderRadius: 14,
    overflow: "hidden",
  },
  btnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  primaryGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 10,
    borderRadius: 14,
  },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  actionsGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  actionCard: {
    flex: 1,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
  },
  actionPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  actionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 4,
  },
  actionDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  quickTip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  tipText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
});
