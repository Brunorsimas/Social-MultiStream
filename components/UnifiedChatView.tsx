import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { ThemeColors } from "@/constants/colors";
import PlatformBadge from "./PlatformBadge";
import ChatWebView from "./ChatWebView";
import { ChatConfig } from "@/lib/storage";
import { useChats } from "@/lib/chat-context";

interface UnifiedChatViewProps {
  chats: ChatConfig[];
  fontSize?: number;
}

interface UnifiedChatPanelProps {
  chat: ChatConfig;
  fontSize: number;
  height: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

function UnifiedChatPanel({ chat, fontSize, height, isCollapsed, onToggleCollapse }: UnifiedChatPanelProps) {
  const { themeColors } = useChats();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [reloadKey, setReloadKey] = useState(0);
  const animatedHeight = useSharedValue(isCollapsed ? 40 : height);

  React.useEffect(() => {
    animatedHeight.value = withTiming(isCollapsed ? 40 : height, { duration: 250 });
  }, [animatedHeight, isCollapsed, height]);

  const containerStyle = useAnimatedStyle(() => ({
    height: animatedHeight.value,
  }));

  const platformColors: Record<string, string> = {
    twitch: themeColors.twitch,
    youtube: themeColors.youtube,
    kick: themeColors.kick,
    facebook: themeColors.facebook,
    tiktok: themeColors.tiktok,
    other: themeColors.primary,
  };

  const accentColor = platformColors[chat.platform] || themeColors.primary;

  return (
    <Animated.View style={[styles.panel, containerStyle, { borderLeftColor: accentColor }]}>
      <View style={styles.panelHeader}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onToggleCollapse();
          }}
          style={styles.collapseTarget}
        >
          <PlatformBadge platform={chat.platform} size={12} />
          <Text style={styles.panelName} numberOfLines={1}>{chat.name}</Text>
          {chat.pinned && <Ionicons name="pin" size={11} color={themeColors.warning} />}
          <View style={styles.panelSpacer} />
          <Ionicons
            name={isCollapsed ? "chevron-down" : "chevron-up"}
            size={14}
            color={themeColors.textMuted}
          />
        </Pressable>
        <Pressable
          onPress={() => setReloadKey((key) => key + 1)}
          hitSlop={8}
          style={styles.panelAction}
          accessibilityRole="button"
          accessibilityLabel={`Reload ${chat.name}`}
        >
          <Ionicons name="refresh" size={13} color={themeColors.textMuted} />
        </Pressable>
      </View>

      {!isCollapsed && (
        <View style={styles.panelContent}>
          <ChatWebView
            key={reloadKey}
            chat={chat}
            fontSize={fontSize}
            showHeader={false}
          />
        </View>
      )}
    </Animated.View>
  );
}

export default function UnifiedChatView({ chats, fontSize = 14 }: UnifiedChatViewProps) {
  const { themeColors } = useChats();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const { height: screenHeight } = useWindowDimensions();

  const expandedCount = chats.filter((c) => !collapsedIds.has(c.id)).length;
  const collapsedCount = chats.length - expandedCount;
  const availableHeight = screenHeight - 120 - (collapsedCount * 40);
  const panelHeight = expandedCount > 0 ? Math.max(220, availableHeight / expandedCount) : 220;

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const collapseAll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (collapsedIds.size === chats.length) {
      setCollapsedIds(new Set());
    } else {
      setCollapsedIds(new Set(chats.map((c) => c.id)));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.unifiedHeader}>
        <Ionicons name="layers" size={16} color={themeColors.primary} />
        <Text style={styles.unifiedTitle}>Unified View</Text>
        <Text style={styles.unifiedCount}>{chats.length} chats</Text>
        <View style={styles.panelSpacer} />
        <Pressable onPress={collapseAll} hitSlop={8} style={styles.collapseAllBtn}>
          <Ionicons
            name={collapsedIds.size === chats.length ? "expand" : "contract"}
            size={16}
            color={themeColors.textSecondary}
          />
        </Pressable>
      </View>
      <ScrollView
        style={styles.panelsList}
        contentContainerStyle={styles.panelsContent}
        showsVerticalScrollIndicator={false}
      >
        {chats.map((chat) => (
          <UnifiedChatPanel
            key={chat.id}
            chat={chat}
            fontSize={fontSize}
            height={panelHeight}
            isCollapsed={collapsedIds.has(chat.id)}
            onToggleCollapse={() => toggleCollapse(chat.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
  },
  unifiedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  unifiedTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: colors.text,
  },
  unifiedCount: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: colors.textMuted,
    backgroundColor: colors.background,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  collapseAllBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  panelsList: {
    flex: 1,
  },
  panelsContent: {
    gap: 4,
    paddingBottom: 8,
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderLeftWidth: 3,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    backgroundColor: colors.surfaceElevated,
    minHeight: 38,
  },
  collapseTarget: {
    flex: 1,
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  panelName: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: colors.text,
    maxWidth: 150,
  },
  panelSpacer: {
    flex: 1,
  },
  panelAction: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  panelContent: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
