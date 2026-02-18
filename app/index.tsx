import React from "react";
import { View, Text, Pressable, StyleSheet, Platform, StatusBar } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useChats } from "@/lib/chat-context";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { chats, activeChats } = useChats();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

  const navigate = (path: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(path as any);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.content, { paddingTop: insets.top + webTopInset + 20, paddingBottom: insets.bottom + webBottomInset + 20 }]}>
        <View style={styles.heroSection}>
          <View style={styles.logoRow}>
            <View style={styles.logoIcon}>
              <MaterialCommunityIcons name="message-flash" size={28} color={Colors.dark.primary} />
            </View>
          </View>
          <Text style={styles.title}>StreamChat</Text>
          <Text style={styles.subtitle}>All your live chats in one place</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{chats.length}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: Colors.dark.success }]}>{activeChats.length}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: Colors.dark.warning }]}>{chats.filter(c => c.pinned).length}</Text>
            <Text style={styles.statLabel}>Pinned</Text>
          </View>
        </View>

        <Pressable
          onPress={() => navigate("/multichat")}
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
        >
          <LinearGradient
            colors={[Colors.dark.primary, Colors.dark.primaryDim]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.primaryGradient}
          >
            <MaterialCommunityIcons name="view-grid" size={22} color="#000" />
            <Text style={styles.primaryBtnText}>Open MultiChat</Text>
          </LinearGradient>
        </Pressable>

        <View style={styles.actionsGrid}>
          <Pressable
            onPress={() => navigate("/add-chat")}
            style={({ pressed }) => [styles.actionCard, pressed && styles.actionPressed]}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: Colors.dark.secondary + "20" }]}>
              <Ionicons name="add-circle" size={24} color={Colors.dark.secondary} />
            </View>
            <Text style={styles.actionTitle}>Add Chat</Text>
            <Text style={styles.actionDesc}>Register a new stream chat</Text>
          </Pressable>

          <Pressable
            onPress={() => navigate("/manage")}
            style={({ pressed }) => [styles.actionCard, pressed && styles.actionPressed]}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: Colors.dark.primary + "20" }]}>
              <Ionicons name="settings-sharp" size={24} color={Colors.dark.primary} />
            </View>
            <Text style={styles.actionTitle}>Manage</Text>
            <Text style={styles.actionDesc}>Edit, reorder & configure</Text>
          </Pressable>
        </View>

        <View style={styles.quickTip}>
          <Ionicons name="information-circle" size={16} color={Colors.dark.textMuted} />
          <Text style={styles.tipText}>
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
    backgroundColor: Colors.dark.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: "center",
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
    backgroundColor: Colors.dark.primary + "15",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.dark.primary + "30",
  },
  title: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
  },
  statsRow: {
    flexDirection: "row",
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.dark.borderLight,
    alignItems: "center",
  },
  statCard: {
    flex: 1,
    alignItems: "center",
  },
  statNumber: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: Colors.dark.border,
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
    fontFamily: "Inter_700Bold",
    color: "#000",
  },
  actionsGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  actionCard: {
    flex: 1,
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.dark.borderLight,
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
    color: Colors.dark.text,
    marginBottom: 4,
  },
  actionDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
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
    color: Colors.dark.textMuted,
    flex: 1,
  },
});
