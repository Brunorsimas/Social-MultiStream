import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import PlatformBadge from "@/components/PlatformBadge";
import { useChats } from "@/lib/chat-context";
import { detectPlatform } from "@/lib/storage";

const PLATFORMS = ["twitch", "youtube", "kick", "facebook", "tiktok", "other"];

export default function AddChatScreen() {
  const insets = useSafeAreaInsets();
  const { addChat, updateChat, chats } = useChats();
  const params = useLocalSearchParams<{ editId?: string }>();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const editingChat = params.editId ? chats.find((c) => c.id === params.editId) : null;

  const [name, setName] = useState(editingChat?.name || "");
  const [url, setUrl] = useState(editingChat?.url || "");
  const [platform, setPlatform] = useState(editingChat?.platform || "");
  const [autoDetected, setAutoDetected] = useState(false);

  useEffect(() => {
    if (url && !editingChat) {
      const detected = detectPlatform(url);
      if (detected !== "other") {
        setPlatform(detected);
        setAutoDetected(true);
      } else {
        setAutoDetected(false);
      }
    }
  }, [url, editingChat]);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Missing Name", "Please enter a name for this chat.");
      return;
    }
    if (!url.trim()) {
      Alert.alert("Missing URL", "Please enter the chat or stream URL.");
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const finalPlatform = platform || detectPlatform(url);

    if (editingChat) {
      await updateChat(editingChat.id, {
        name: name.trim(),
        url: url.trim(),
        platform: finalPlatform,
      });
      router.push({
        pathname: "/platform-login",
        params: { platform: finalPlatform, chatUrl: url.trim() },
      } as any);
    } else {
      await addChat({
        name: name.trim(),
        url: url.trim(),
        platform: finalPlatform,
        enabled: true,
        pinned: false,
      });
      router.push({
        pathname: "/platform-login",
        params: { platform: finalPlatform, chatUrl: url.trim() },
      } as any);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + webTopInset + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={Colors.dark.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{editingChat ? "Edit Chat" : "Add Chat"}</Text>
        <Pressable onPress={handleSave} hitSlop={12}>
          <Ionicons name="checkmark" size={26} color={Colors.dark.primary} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.field}>
          <Text style={styles.label}>Chat Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. My Twitch Chat"
            placeholderTextColor={Colors.dark.textMuted}
            autoCapitalize="words"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Stream / Chat URL</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="https://twitch.tv/channel"
            placeholderTextColor={Colors.dark.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {autoDetected && (
            <View style={styles.detectedRow}>
              <Ionicons name="checkmark-circle" size={14} color={Colors.dark.success} />
              <Text style={styles.detectedText}>
                Platform detected: {platform}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Platform</Text>
          <View style={styles.platformGrid}>
            {PLATFORMS.map((p) => (
              <Pressable
                key={p}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setPlatform(p);
                  setAutoDetected(false);
                }}
                style={[styles.platformOption, platform === p && styles.platformSelected]}
              >
                <PlatformBadge platform={p} size={14} />
                <Text style={[styles.platformText, platform === p && styles.platformTextSelected]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.helpBox}>
          <Ionicons name="help-circle" size={18} color={Colors.dark.textMuted} />
          <Text style={styles.helpText}>
            Paste the full URL of the stream or chat page. StreamChat will automatically convert it to an embeddable chat view when possible.
          </Text>
        </View>
      </ScrollView>
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 24,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.text,
    borderWidth: 1,
    borderColor: Colors.dark.borderLight,
  },
  detectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  detectedText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.success,
  },
  platformGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  platformOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: Colors.dark.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.dark.borderLight,
  },
  platformSelected: {
    borderColor: Colors.dark.primary,
    backgroundColor: Colors.dark.primary + "10",
  },
  platformText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.textSecondary,
  },
  platformTextSelected: {
    color: Colors.dark.primary,
  },
  helpBox: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.dark.borderLight,
  },
  helpText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
    lineHeight: 18,
  },
});
