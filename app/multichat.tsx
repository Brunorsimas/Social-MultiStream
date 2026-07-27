import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform, ScrollView, Switch, useWindowDimensions, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useKeepAwake } from "expo-keep-awake";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import ChatWebView from "@/components/ChatWebView";
import MergedChatView from "@/components/MergedChatView";
import UnifiedChatView from "@/components/UnifiedChatView";
import UnifiedTimeline from "@/components/UnifiedTimeline";
import { useChats } from "@/lib/chat-context";

type LayoutMode = "columns" | "grid" | "list" | "merged";

function KeepAwakeGuard() {
  useKeepAwake();
  return null;
}

export default function MultiChatScreen() {
  const insets = useSafeAreaInsets();
  const { activeChats, settings, updateSettings, togglePin, themeColors } = useChats();
  const [showControls, setShowControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const layout: LayoutMode = settings.layout;
  const fontSize = settings.fontSize;
  const unifiedMode = settings.unifiedMode;
  const isDark = settings.theme === "dark";
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const { width: screenWidth } = useWindowDimensions();

  const persistSettings = (updates: Parameters<typeof updateSettings>[0]) => {
    void updateSettings(updates).catch(() => {
      Alert.alert("Could Not Save", "The setting could not be persisted.");
    });
  };

  const persistPin = (chatId: string) => {
    void togglePin(chatId).catch(() => {
      Alert.alert("Could Not Save", "The pinned state could not be persisted.");
    });
  };

  const toggleUnifiedMode = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = !unifiedMode;
    persistSettings({ unifiedMode: next });
    if (!next) {
      setFullscreen(false);
      setShowControls(true);
    }
  };

  const toggleTheme = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    persistSettings({ theme: isDark ? "light" : "dark" });
  };

  const cycleLayout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const modes: LayoutMode[] = ["columns", "grid", "list", "merged"];
    const nextIndex = (modes.indexOf(layout) + 1) % modes.length;
    const next = modes[nextIndex];
    persistSettings({ layout: next });
  };

  const adjustFontSize = (delta: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newSize = Math.max(10, Math.min(24, fontSize + delta));
    persistSettings({ fontSize: newSize });
  };

  const getLayoutIcon = (): string => {
    switch (layout) {
      case "columns": return "view-column";
      case "grid": return "view-grid";
      case "list": return "view-sequential";
      case "merged": return "tab";
      default: return "view-grid";
    }
  };

  const getLayoutLabel = (): string => {
    if (unifiedMode) return "Unified";
    switch (layout) {
      case "columns": return "Columns";
      case "grid": return "Grid";
      case "list": return "List";
      case "merged": return "Tabs";
      default: return "";
    }
  };

  const renderChats = () => {
    if (activeChats.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="chatbubbles-outline" size={48} color={themeColors.textMuted} />
          <Text style={[styles.emptyTitle, { color: themeColors.text }]}>No active chats</Text>
          <Text style={[styles.emptyDesc, { color: themeColors.textMuted }]}>Enable some chats from the Manage screen</Text>
          <Pressable
            onPress={() => router.push("/manage" as any)}
            style={({ pressed }) => [styles.emptyBtn, { backgroundColor: themeColors.primary }, pressed && { opacity: 0.8 }]}
          >
            <Text style={[styles.emptyBtnText, { color: themeColors.background }]}>Manage Chats</Text>
          </Pressable>
        </View>
      );
    }

    if (unifiedMode) {
      if (Platform.OS === "web") {
        return <UnifiedChatView chats={activeChats} fontSize={fontSize} />;
      }

      return (
        <UnifiedTimeline
          chats={activeChats}
          fontSize={fontSize}
          onFontSizeChange={adjustFontSize}
          isFullscreen={fullscreen}
          onToggleFullscreen={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            const next = !fullscreen;
            setFullscreen(next);
            setShowControls(!next);
          }}
        />
      );
    }

    if (layout === "merged") {
      return <MergedChatView chats={activeChats} fontSize={fontSize} />;
    }

    if (layout === "list") {
      return (
        <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.listLayout}>
          {activeChats.map((chat) => (
            <View key={chat.id} style={styles.listItem}>
              <ChatWebView chat={chat} compact fontSize={fontSize} onPin={() => persistPin(chat.id)} />
            </View>
          ))}
        </ScrollView>
      );
    }

    if (layout === "grid") {
      const cols = activeChats.length <= 2 ? 1 : 2;
      const chatWidth = (screenWidth - 16 - (cols > 1 ? 8 : 0)) / cols;

      return (
        <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.gridLayout}>
          {activeChats.map((chat) => (
            <View key={chat.id} style={[styles.gridItem, { width: cols > 1 ? chatWidth : "100%" }]}>
              <ChatWebView chat={chat} compact fontSize={fontSize} onPin={() => persistPin(chat.id)} />
            </View>
          ))}
        </ScrollView>
      );
    }

    return (
      <View style={styles.columnsLayout}>
        {activeChats.map((chat) => (
          <View key={chat.id} style={styles.columnItem}>
            <ChatWebView chat={chat} fontSize={fontSize} onPin={() => persistPin(chat.id)} />
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      {settings.keepScreenOn && <KeepAwakeGuard />}
      {showControls && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(200)}
          style={[styles.toolbar, { paddingTop: insets.top + webTopInset + 8, backgroundColor: themeColors.surface + "F0", borderBottomColor: themeColors.borderLight }]}
        >
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={themeColors.text} />
          </Pressable>

          <View style={styles.toolbarCenter}>
            <Text style={[styles.toolbarTitle, { color: themeColors.textSecondary }]}>
              {activeChats.length} chat{activeChats.length !== 1 ? "s" : ""} · {getLayoutLabel()}
            </Text>
          </View>

          <View style={styles.toolbarActions}>
            <Pressable
              onPress={toggleTheme}
              hitSlop={8}
              style={styles.toolBtn}
            >
              <Ionicons
                name={isDark ? "sunny" : "moon"}
                size={18}
                color={isDark ? themeColors.warning : themeColors.secondary}
              />
            </Pressable>
            <Pressable
              onPress={() => persistSettings({ keepScreenOn: !settings.keepScreenOn })}
              hitSlop={8}
              style={styles.toolBtn}
            >
              <Ionicons
                name={settings.keepScreenOn ? "eye" : "eye-off-outline"}
                size={18}
                color={settings.keepScreenOn ? themeColors.warning : themeColors.textMuted}
              />
            </Pressable>
            <Pressable onPress={() => adjustFontSize(-1)} hitSlop={8} style={styles.toolBtn}>
              <MaterialCommunityIcons name="format-font-size-decrease" size={18} color={themeColors.textSecondary} />
            </Pressable>
            <Pressable onPress={() => adjustFontSize(1)} hitSlop={8} style={styles.toolBtn}>
              <MaterialCommunityIcons name="format-font-size-increase" size={18} color={themeColors.textSecondary} />
            </Pressable>
            {!unifiedMode && (
              <Pressable onPress={cycleLayout} hitSlop={8} style={styles.toolBtn}>
                <MaterialCommunityIcons name={getLayoutIcon() as any} size={18} color={themeColors.primary} />
              </Pressable>
            )}
          </View>
        </Animated.View>
      )}

      {showControls && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(200)}
          style={[styles.unifiedToggleBar, { backgroundColor: themeColors.surface, borderBottomColor: themeColors.borderLight }]}
        >
          <Ionicons name="layers" size={16} color={unifiedMode ? themeColors.primary : themeColors.textMuted} />
          <Text style={[styles.unifiedToggleText, { color: unifiedMode ? themeColors.primary : themeColors.textMuted, fontFamily: unifiedMode ? "Inter_600SemiBold" : "Inter_400Regular" }]}>
            Unified Mode
          </Text>
          <Switch
            value={unifiedMode}
            onValueChange={toggleUnifiedMode}
            trackColor={{ false: themeColors.border, true: themeColors.primary + "60" }}
            thumbColor={unifiedMode ? themeColors.primary : themeColors.textMuted}
            style={{ transform: [{ scale: 0.8 }] }}
          />
        </Animated.View>
      )}

      <View
        style={[
          styles.chatArea,
          unifiedMode && styles.chatAreaUnified,
          !showControls && { paddingTop: insets.top + webTopInset },
        ]}
      >
        {renderChats()}
      </View>

      {!unifiedMode && (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowControls(!showControls);
          }}
          style={[styles.toggleFab, { bottom: insets.bottom + 16, backgroundColor: themeColors.surfaceElevated + "E0", borderColor: themeColors.border }]}
        >
          <Ionicons
            name={showControls ? "eye-off" : "eye"}
            size={20}
            color={themeColors.text}
          />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    zIndex: 10,
  },
  toolbarCenter: {
    flex: 1,
    alignItems: "center",
  },
  toolbarTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  toolbarActions: {
    flexDirection: "row",
    gap: 2,
  },
  toolBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  unifiedToggleBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  unifiedToggleText: {
    flex: 1,
    fontSize: 13,
  },
  chatArea: {
    flex: 1,
    padding: 8,
  },
  chatAreaUnified: {
    padding: 0,
  },
  columnsLayout: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
  },
  columnItem: {
    flex: 1,
  },
  scrollContainer: {
    flex: 1,
  },
  gridLayout: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 60,
  },
  gridItem: {
    height: 300,
  },
  listLayout: {
    gap: 8,
    paddingBottom: 60,
  },
  listItem: {
    height: 280,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    marginTop: 8,
  },
  emptyDesc: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  emptyBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginTop: 8,
  },
  emptyBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  toggleFab: {
    position: "absolute",
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    zIndex: 20,
  },
});
