import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemeColors } from "@/constants/colors";
import PlatformBadge from "@/components/PlatformBadge";
import { useChats } from "@/lib/chat-context";
import { detectPlatform, normalizeChatUrl } from "@/lib/storage";
import { isResolvableChatUrl } from "@/lib/chat-url";

const PLATFORMS = ["twitch", "youtube", "kick", "facebook", "tiktok", "other"];

export default function AddChatScreen() {
  const insets = useSafeAreaInsets();
  const { addChat, updateChat, chats, isLoading, themeColors } = useChats();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const params = useLocalSearchParams<{ editId?: string }>();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const editingChat = params.editId ? chats.find((c) => c.id === params.editId) : null;

  const [name, setName] = useState(editingChat?.name || "");
  const [url, setUrl] = useState(editingChat?.url || "");
  const [platform, setPlatform] = useState(editingChat?.platform || "");
  const [autoDetected, setAutoDetected] = useState(false);
  const [platformManuallySelected, setPlatformManuallySelected] = useState(Boolean(editingChat));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!params.editId || isLoading || !editingChat) return;
    setName(editingChat.name);
    setUrl(editingChat.url);
    setPlatform(editingChat.platform);
    setPlatformManuallySelected(true);
    setAutoDetected(false);
  }, [editingChat, isLoading, params.editId]);

  useEffect(() => {
    if (params.editId && !isLoading && !editingChat) {
      Alert.alert("Chat Not Found", "This chat no longer exists.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    }
  }, [editingChat, isLoading, params.editId]);

  useEffect(() => {
    if (url && !editingChat && !platformManuallySelected) {
      const detected = detectPlatform(url);
      setPlatform(detected);
      setAutoDetected(detected !== "other");
    }
  }, [url, editingChat, platformManuallySelected]);

  const handleSave = async () => {
    if (saving) return;
    if (!name.trim()) {
      Alert.alert("Missing Name", "Please enter a name for this chat.");
      return;
    }
    const platformHint = platform && platform !== "other" ? platform : undefined;
    const normalizedUrl = normalizeChatUrl(url, platformHint);
    if (!normalizedUrl) {
      Alert.alert("Invalid URL", "Enter a valid HTTP or HTTPS chat URL.");
      return;
    }

    const finalPlatform = platformHint || detectPlatform(normalizedUrl);
    if (!isResolvableChatUrl(normalizedUrl, finalPlatform)) {
      Alert.alert(
        "Unsupported Chat URL",
        "Use @usuario or a channel/chat URL for Twitch, Kick, or YouTube. YouTube watch/live links are also accepted.",
      );
      return;
    }
    setSaving(true);

    try {
      if (editingChat) {
        await updateChat(editingChat.id, {
          name: name.trim(),
          url: normalizedUrl,
          platform: finalPlatform,
        });
      } else {
        await addChat({
          name: name.trim(),
          url: normalizedUrl,
          platform: finalPlatform,
          enabled: true,
          pinned: false,
        });
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {
      Alert.alert("Could Not Save", "The chat could not be saved. Please try again.");
      setSaving(false);
    }
  };

  if (isLoading && params.editId) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingState}>
          <ActivityIndicator color={themeColors.primary} />
          <Text style={styles.helpText}>Loading chat...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + webTopInset + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={themeColors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{editingChat ? "Edit Chat" : "Add Chat"}</Text>
        <Pressable onPress={handleSave} hitSlop={12} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color={themeColors.primary} />
          ) : (
            <Ionicons name="checkmark" size={26} color={themeColors.primary} />
          )}
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
            placeholderTextColor={themeColors.textMuted}
            autoCapitalize="words"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Stream / Chat URL</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="@usuario ou link do chat"
            placeholderTextColor={themeColors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {autoDetected && (
            <View style={styles.detectedRow}>
              <Ionicons name="checkmark-circle" size={14} color={themeColors.success} />
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
                   setPlatformManuallySelected(true);
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
          <Ionicons name="help-circle" size={18} color={themeColors.textMuted} />
          <Text style={styles.helpText}>
            Cole o link da transmissao, do chat, ou use @usuario. Para @usuario, selecione antes a plataforma correta.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: colors.text,
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
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.borderLight,
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
    color: colors.success,
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
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  platformSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "10",
  },
  platformText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: colors.textSecondary,
  },
  platformTextSelected: {
    color: colors.primary,
  },
  helpBox: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  helpText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: colors.textMuted,
    lineHeight: 18,
  },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
});
