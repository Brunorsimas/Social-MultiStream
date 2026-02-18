import React from "react";
import { View, Text, Pressable, StyleSheet, FlatList, Platform, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import ChatCard from "@/components/ChatCard";
import { useChats } from "@/lib/chat-context";
import { ChatConfig } from "@/lib/storage";

export default function ManageScreen() {
  const insets = useSafeAreaInsets();
  const { chats, toggleChat, togglePin, removeChat, moveChat } = useChats();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

  const handleDelete = (chat: ChatConfig) => {
    Alert.alert(
      "Remove Chat",
      `Remove "${chat.name}" from your list?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            removeChat(chat.id);
          },
        },
      ]
    );
  };

  const renderItem = ({ item, index }: { item: ChatConfig; index: number }) => (
    <ChatCard
      chat={item}
      onToggle={() => toggleChat(item.id)}
      onEdit={() => router.push({ pathname: "/add-chat", params: { editId: item.id } } as any)}
      onDelete={() => handleDelete(item)}
      onPin={() => togglePin(item.id)}
      onMoveUp={() => moveChat(index, index - 1)}
      onMoveDown={() => moveChat(index, index + 1)}
      isFirst={index === 0}
      isLast={index === chats.length - 1}
    />
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + webTopInset + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={Colors.dark.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Manage Chats</Text>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/add-chat" as any);
          }}
          hitSlop={12}
        >
          <Ionicons name="add" size={26} color={Colors.dark.primary} />
        </Pressable>
      </View>

      <FlatList
        data={chats}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + webBottomInset + 20 },
        ]}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={48} color={Colors.dark.textMuted} />
            <Text style={styles.emptyTitle}>No chats yet</Text>
            <Text style={styles.emptyDesc}>
              Add your first stream chat to get started
            </Text>
            <Pressable
              onPress={() => router.push("/add-chat" as any)}
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="add" size={20} color={Colors.dark.background} />
              <Text style={styles.addBtnText}>Add Chat</Text>
            </Pressable>
          </View>
        }
      />
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
  headerTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  listContent: {
    padding: 16,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
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
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginTop: 12,
  },
  addBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.background,
  },
});
