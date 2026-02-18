import React from "react";
import { View, Text, Pressable, StyleSheet, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import PlatformBadge from "./PlatformBadge";
import { ChatConfig } from "@/lib/storage";

interface ChatCardProps {
  chat: ChatConfig;
  onToggle: () => void;
  onEdit: () => void;
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
  onDelete,
  onPin,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: ChatCardProps) {
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
          trackColor={{ false: Colors.dark.border, true: Colors.dark.primary + "60" }}
          thumbColor={chat.enabled ? Colors.dark.primary : Colors.dark.textMuted}
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
            color={chat.pinned ? Colors.dark.warning : Colors.dark.textMuted}
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
            <Ionicons name="chevron-up" size={18} color={Colors.dark.textMuted} />
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
            <Ionicons name="chevron-down" size={18} color={Colors.dark.textMuted} />
          </Pressable>
        )}
        <View style={styles.spacer} />
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onEdit();
          }}
          style={styles.actionBtn}
        >
          <Ionicons name="create-outline" size={18} color={Colors.dark.primary} />
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onDelete();
          }}
          style={styles.actionBtn}
        >
          <Ionicons name="trash-outline" size={18} color={Colors.dark.error} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.dark.borderLight,
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
    color: Colors.dark.text,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  url: {
    color: Colors.dark.textMuted,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.borderLight,
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
