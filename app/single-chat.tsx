import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useKeepAwake } from "expo-keep-awake";
import Colors from "@/constants/colors";
import ChatWebView from "@/components/ChatWebView";
import { useChats } from "@/lib/chat-context";

export default function SingleChatScreen() {
  const insets = useSafeAreaInsets();
  const { chats, togglePin } = useChats();
  const { id } = useLocalSearchParams<{ id: string }>();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  useKeepAwake();

  const chat = chats.find((c) => c.id === id);

  if (!chat) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + webTopInset + 12 }]}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={Colors.dark.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Chat Not Found</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.dark.textMuted} />
          <Text style={styles.errorText}>This chat could not be found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + webTopInset + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={Colors.dark.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{chat.name}</Text>
        <Pressable onPress={() => togglePin(chat.id)} hitSlop={12}>
          <Ionicons
            name={chat.pinned ? "pin" : "pin-outline"}
            size={22}
            color={chat.pinned ? Colors.dark.warning : Colors.dark.textMuted}
          />
        </Pressable>
      </View>
      <View style={styles.chatContainer}>
        <ChatWebView chat={chat} showHeader={false} />
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
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginHorizontal: 12,
  },
  chatContainer: {
    flex: 1,
  },
  errorState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  errorText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
  },
});
