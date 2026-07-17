import React, { useMemo } from "react";
import { View, Text, Pressable, StyleSheet, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemeColors } from "@/constants/colors";
import PlatformBadge from "./PlatformBadge";
import { ChatConfig } from "@/lib/storage";
import { useChats } from "@/lib/chat-context";

interface ChatCardProps {
  chat: ChatConfig;
  onToggle: () => void;
  onEdit: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onPin: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}

export default function ChatCard({
  chat,
  onToggle,
  onEdit,
  onOpen,
  onDelete,
  onPin,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: ChatCardProps) {
  const { themeColors } = useChats();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  return (
    <View style={[styles.card, !chat.enabled && styles.cardDisabled]}>
      <View style={styles.header}>
        <PlatformBadge platform={chat.platform} />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {chat.name}
          </Text>
          <Text style={styles.url} numberOfLines={1}>
            {chat.url}
          </Text>
        </View>
        <Switch
          value={chat.enabled}
          onValueChange={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onToggle();
          }}
          trackColor={{ false: themeColors.border, true: themeColors.primary + "60" }}
          thumbColor={chat.enabled ? themeColors.primary : themeColors.textMuted}
        />
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onPin();
          }}
          style={styles.actionBtn}
        >
          <Ionicons
            name={chat.pinned ? "pin" : "pin-outline"}
            size={18}
            color={chat.pinned ? themeColors.warning : themeColors.textMuted}
          />
        </Pressable>
        {!isFirst && (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onMoveUp?.();
            }}
            style={styles.actionBtn}
          >
            <Ionicons name="chevron-up" size={18} color={themeColors.textMuted} />
          </Pressable>
        )}
        {!isLast && (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onMoveDown?.();
            }}
            style={styles.actionBtn}
          >
            <Ionicons name="chevron-down" size={18} color={themeColors.textMuted} />
          </Pressable>
        )}
        <View style={styles.spacer} />
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onOpen();
          }}
          style={styles.actionBtn}
        >
          <Ionicons name="open-outline" size={18} color={themeColors.textSecondary} />
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onEdit();
          }}
          style={styles.actionBtn}
        >
          <Ionicons name="create-outline" size={18} color={themeColors.primary} />
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onDelete();
          }}
          style={styles.actionBtn}
        >
          <Ionicons name="trash-outline" size={18} color={themeColors.error} />
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  cardDisabled: {
    opacity: 0.5,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  url: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    gap: 4,
  },
  actionBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  spacer: {
    flex: 1,
  },
});
