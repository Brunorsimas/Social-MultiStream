import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import HiddenChatCollector from "./HiddenChatCollector";
import { ChatConfig } from "@/lib/storage";
import { globalAggregator, UnifiedChatMessage } from "@/lib/message-aggregator";

interface UnifiedTimelineProps {
  chats: ChatConfig[];
  fontSize?: number;
  onFontSizeChange?: (delta: number) => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
}

const PLATFORM_LABEL: Record<string, string> = {
  twitch: "TWITCH",
  youtube: "YOUTUBE",
  kick: "KICK",
  facebook: "FACEBOOK",
  tiktok: "TIKTOK",
  unknown: "CHAT",
  other: "CHAT",
};

const PLATFORM_COLOR: Record<string, string> = {
  twitch: Colors.dark.twitch,
  youtube: Colors.dark.youtube,
  kick: Colors.dark.kick,
  facebook: Colors.dark.facebook,
  tiktok: Colors.dark.tiktok,
  unknown: Colors.dark.primary,
  other: Colors.dark.primary,
};

function AvatarPlaceholder({ name, color }: { name: string; color: string }) {
  const initials = name ? name.charAt(0).toUpperCase() : "?";
  return (
    <View style={[styles.avatar, { backgroundColor: color + "30" }]}>
      <Text style={[styles.avatarText, { color }]}>{initials}</Text>
    </View>
  );
}

function PlatformPill({ platform }: { platform: string }) {
  const label = PLATFORM_LABEL[platform] || "CHAT";
  const color = PLATFORM_COLOR[platform] || Colors.dark.primary;
  return (
    <View style={[styles.platformPill, { backgroundColor: color }]}>
      <Text style={styles.platformPillText}>{label}</Text>
    </View>
  );
}

interface MessageItemProps {
  item: UnifiedChatMessage;
  fontSize: number;
}

function MessageItem({ item, fontSize }: MessageItemProps) {
  const color = PLATFORM_COLOR[item.platform] || Colors.dark.primary;
  const timeStr = new Date(item.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <View style={styles.messageRow}>
      <AvatarPlaceholder name={item.userName} color={color} />
      <View style={styles.messageBody}>
        <View style={styles.messageTopRow}>
          <PlatformPill platform={item.platform} />
          <Text style={[styles.userName, { color }]} numberOfLines={1}>
            {item.userName}
          </Text>
          <Text style={styles.messageTime}>{timeStr}</Text>
        </View>
        <Text style={[styles.messageText, { fontSize }]}>{item.message}</Text>
      </View>
    </View>
  );
}

export default function UnifiedTimeline({
  chats,
  fontSize = 14,
  onFontSizeChange,
  onToggleFullscreen,
  isFullscreen = false,
}: UnifiedTimelineProps) {
  const [messages, setMessages] = useState<UnifiedChatMessage[]>(
    globalAggregator.getMessages()
  );
  const [paused, setPaused] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const unsub = globalAggregator.subscribe((msgs) => {
      setMessages(msgs);
      if (pausedRef.current) {
        setHasNew(true);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!paused && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 80);
    }
  }, [messages.length, paused]);


  const togglePause = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPaused((p) => {
      if (p) {
        setHasNew(false);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
      }
      return !p;
    });
  };

  const resumeAndScroll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPaused(false);
    setHasNew(false);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
  };

  const clearMessages = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    globalAggregator.clear();
    setHasNew(false);
  };

  const renderItem = useCallback(
    ({ item }: { item: UnifiedChatMessage }) => (
      <MessageItem item={item} fontSize={fontSize} />
    ),
    [fontSize]
  );

  const keyExtractor = useCallback(
    (item: UnifiedChatMessage) => item.messageId,
    []
  );

  const totalConnected = chats.length;

  return (
    <View style={styles.container}>
      {chats.map((chat) => (
        <HiddenChatCollector key={chat.id} chat={chat} fontSize={fontSize} />
      ))}

      <View style={styles.topBar}>
        <View style={styles.liveDot} />
        <Text style={styles.liveText}>Live</Text>
        <Text style={styles.connectedText}>
          {" "}• {totalConnected} Connected
        </Text>
      </View>

      {messages.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="radio-outline" size={40} color={Colors.dark.textMuted} />
          <Text style={styles.emptyTitle}>Waiting for messages...</Text>
          <Text style={styles.emptyDesc}>
            Messages from {chats.length} active chat
            {chats.length !== 1 ? "s" : ""} will appear here in real time.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={30}
          maxToRenderPerBatch={20}
          windowSize={15}
          removeClippedSubviews={Platform.OS !== "web"}
        />
      )}

      {(paused || hasNew) && (
        <Pressable onPress={resumeAndScroll} style={styles.newMsgBtn}>
          <Ionicons name="arrow-down" size={14} color="#fff" />
          <Text style={styles.newMsgText}>
            {paused ? "New messages paused" : "New messages"}
          </Text>
        </Pressable>
      )}

      <View style={styles.bottomBar}>
        <Pressable onPress={togglePause} hitSlop={10} style={styles.barBtn}>
          <Ionicons
            name={paused ? "play" : "pause"}
            size={20}
            color={paused ? Colors.dark.warning : Colors.dark.textSecondary}
          />
        </Pressable>
        <Pressable
          onPress={() => onFontSizeChange?.(-1)}
          hitSlop={10}
          style={styles.barBtn}
        >
          <Text style={styles.fontLabel}>−</Text>
        </Pressable>
        <View style={styles.aaLabel}>
          <Text style={styles.aaText}>Aa</Text>
        </View>
        <Pressable
          onPress={() => onFontSizeChange?.(1)}
          hitSlop={10}
          style={styles.barBtn}
        >
          <Text style={styles.fontLabel}>+</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onToggleFullscreen?.();
          }}
          hitSlop={10}
          style={styles.barBtn}
        >
          <Ionicons
            name={isFullscreen ? "contract" : "expand"}
            size={22}
            color={isFullscreen ? Colors.dark.primary : Colors.dark.textSecondary}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111118",
    borderRadius: 12,
    overflow: "hidden",
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#111118",
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.borderLight,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.dark.kick,
    marginRight: 6,
  },
  liveText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.kick,
  },
  connectedText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.kick,
  },

  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },

  messageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  messageBody: {
    flex: 1,
  },
  messageTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 3,
  },
  platformPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    flexShrink: 0,
  },
  platformPillText: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: 0.5,
  },
  userName: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    flexShrink: 1,
  },
  messageTime: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
    marginLeft: "auto" as any,
    flexShrink: 0,
  },
  messageText: {
    fontFamily: "Inter_400Regular",
    color: Colors.dark.text,
    lineHeight: 20,
  },

  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
    marginTop: 8,
  },
  emptyDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
    textAlign: "center",
    lineHeight: 18,
  },

  newMsgBtn: {
    position: "absolute",
    bottom: 70,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#00BFA5",
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  newMsgText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.dark.surfaceElevated,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    borderRadius: 20,
    margin: 8,
    marginTop: 0,
  },
  barBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  fontLabel: {
    fontSize: 22,
    color: Colors.dark.textSecondary,
    fontFamily: "Inter_400Regular",
    lineHeight: 26,
  },
  aaLabel: {
    paddingHorizontal: 4,
  },
  aaText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
  },
});
