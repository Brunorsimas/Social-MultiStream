import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform, ScrollView, Dimensions, Switch } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useKeepAwake } from "expo-keep-awake";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import Colors from "@/constants/colors";
import ChatWebView from "@/components/ChatWebView";
import MergedChatView from "@/components/MergedChatView";
import UnifiedTimeline from "@/components/UnifiedTimeline";
import { useChats } from "@/lib/chat-context";

type LayoutMode = "columns" | "grid" | "list" | "merged";

export default function MultiChatScreen() {
  const insets = useSafeAreaInsets();
  const { activeChats, settings, updateSettings, togglePin } = useChats();
  const [showControls, setShowControls] = useState(true);
  const [layout, setLayout] = useState<LayoutMode>(settings.layout);
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [unifiedMode, setUnifiedMode] = useState(settings.unifiedMode);
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  useKeepAwake();

  const screenWidth = Dimensions.get("window").width;

  const toggleUnifiedMode = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = !unifiedMode;
    setUnifiedMode(next);
    updateSettings({ unifiedMode: next });
  };

  const cycleLayout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const modes: LayoutMode[] = ["columns", "grid", "list", "merged"];
    const nextIndex = (modes.indexOf(layout) + 1) % modes.length;
    const next = modes[nextIndex];
    setLayout(next);
    updateSettings({ layout: next as any });
  };

  const adjustFontSize = (delta: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newSize = Math.max(10, Math.min(24, fontSize + delta));
    setFontSize(newSize);
    updateSettings({ fontSize: newSize });
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
          <Ionicons name="chatbubbles-outline" size={48} color={Colors.dark.textMuted} />
          <Text style={styles.emptyTitle}>No active chats</Text>
          <Text style={styles.emptyDesc}>Enable some chats from the Manage screen</Text>
          <Pressable
            onPress={() => router.push("/manage" as any)}
            style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.emptyBtnText}>Manage Chats</Text>
          </Pressable>
        </View>
      );
    }

    if (unifiedMode) {
      return (
        <UnifiedTimeline
          chats={activeChats}
          fontSize={fontSize}
          onFontSizeChange={adjustFontSize}
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
              <ChatWebView chat={chat} compact fontSize={fontSize} onPin={() => togglePin(chat.id)} />
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
              <ChatWebView chat={chat} compact fontSize={fontSize} onPin={() => togglePin(chat.id)} />
            </View>
          ))}
        </ScrollView>
      );
    }

    return (
      <View style={styles.columnsLayout}>
        {activeChats.map((chat) => (
          <View key={chat.id} style={styles.columnItem}>
            <ChatWebView chat={chat} fontSize={fontSize} onPin={() => togglePin(chat.id)} />
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {showControls && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(200)}
          style={[styles.toolbar, { paddingTop: insets.top + webTopInset + 8 }]}
        >
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={Colors.dark.text} />
          </Pressable>

          <View style={styles.toolbarCenter}>
            <Text style={styles.toolbarTitle}>
              {activeChats.length} chat{activeChats.length !== 1 ? "s" : ""} · {getLayoutLabel()}
            </Text>
          </View>

          <View style={styles.toolbarActions}>
            <Pressable onPress={() => adjustFontSize(-2)} hitSlop={8} style={styles.toolBtn}>
              <MaterialCommunityIcons name="format-font-size-decrease" size={18} color={Colors.dark.textSecondary} />
            </Pressable>
            <Pressable onPress={() => adjustFontSize(2)} hitSlop={8} style={styles.toolBtn}>
              <MaterialCommunityIcons name="format-font-size-increase" size={18} color={Colors.dark.textSecondary} />
            </Pressable>
            {!unifiedMode && (
              <Pressable onPress={cycleLayout} hitSlop={8} style={styles.toolBtn}>
                <MaterialCommunityIcons name={getLayoutIcon() as any} size={18} color={Colors.dark.primary} />
              </Pressable>
            )}
          </View>
        </Animated.View>
      )}

      {showControls && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(200)}
          style={styles.unifiedToggleBar}
        >
          <Ionicons name="layers" size={16} color={unifiedMode ? Colors.dark.primary : Colors.dark.textMuted} />
          <Text style={[styles.unifiedToggleText, unifiedMode && styles.unifiedToggleTextActive]}>
            Unified Mode
          </Text>
          <Switch
            value={unifiedMode}
            onValueChange={toggleUnifiedMode}
            trackColor={{ false: Colors.dark.border, true: Colors.dark.primary + "60" }}
            thumbColor={unifiedMode ? Colors.dark.primary : Colors.dark.textMuted}
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
          style={[styles.toggleFab, { bottom: insets.bottom + 16 }]}
        >
          <Ionicons
            name={showControls ? "eye-off" : "eye"}
            size={20}
            color={Colors.dark.text}
          />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: Colors.dark.surface + "F0",
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.borderLight,
    zIndex: 10,
  },
  toolbarCenter: {
    flex: 1,
    alignItems: "center",
  },
  toolbarTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
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
    backgroundColor: Colors.dark.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.borderLight,
  },
  unifiedToggleText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.textMuted,
  },
  unifiedToggleTextActive: {
    color: Colors.dark.primary,
    fontFamily: "Inter_600SemiBold",
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
    color: Colors.dark.text,
    marginTop: 8,
  },
  emptyDesc: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
    textAlign: "center",
  },
  emptyBtn: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginTop: 8,
  },
  emptyBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.background,
  },
  toggleFab: {
    position: "absolute",
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.dark.surfaceElevated + "E0",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.dark.border,
    zIndex: 20,
  },
});
