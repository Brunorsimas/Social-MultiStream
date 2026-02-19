import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, Image, Platform } from "react-native";
import { Ionicons, FontAwesome5, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, SlideInRight } from "react-native-reanimated";
import Colors from "@/constants/colors";
import PlatformBadge from "./PlatformBadge";
import HiddenChatCollector from "./HiddenChatCollector";
import { ChatConfig } from "@/lib/storage";
import { globalAggregator, UnifiedChatMessage } from "@/lib/message-aggregator";

interface UnifiedTimelineProps {
  chats: ChatConfig[];
  fontSize?: number;
}

const platformColors: Record<string, string> = {
  twitch: Colors.dark.twitch,
  youtube: Colors.dark.youtube,
  kick: Colors.dark.kick,
  facebook: Colors.dark.facebook,
  tiktok: Colors.dark.tiktok,
  unknown: Colors.dark.primary,
  other: Colors.dark.primary,
};

interface MessageItemProps {
  item: UnifiedChatMessage;
}

function MessageItem({ item }: MessageItemProps) {
  const color = platformColors[item.platform] || Colors.dark.primary;

  return (
    <View style={[styles.messageRow, { borderLeftColor: color }]}>
      <View style={styles.messageHeader}>
        <View style={[styles.platformDot, { backgroundColor: color }]} />
        <Text style={[styles.userName, { color }]} numberOfLines={1}>
          {item.userName}
        </Text>
        <Text style={styles.chatOrigin} numberOfLines={1}>
          {item.chatName}
        </Text>
        <Text style={styles.messageTime}>
          {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </Text>
      </View>
      <Text style={styles.messageText}>{item.message}</Text>
    </View>
  );
}

export default function UnifiedTimeline({ chats, fontSize = 14 }: UnifiedTimelineProps) {
  const [messages, setMessages] = useState<UnifiedChatMessage[]>(globalAggregator.getMessages());
  const [autoScroll, setAutoScroll] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    const unsubscribe = globalAggregator.subscribe((msgs) => {
      setMessages(msgs);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (autoScroll && isAtBottom && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length, autoScroll, isAtBottom]);

  useEffect(() => {
    return () => {
      globalAggregator.clear();
    };
  }, []);

  const handleScroll = useCallback((event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    setIsAtBottom(distFromBottom < 80);
  }, []);

  const toggleAutoScroll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !autoScroll;
    setAutoScroll(next);
    if (next) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  };

  const clearMessages = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    globalAggregator.clear();
  };

  const renderMessage = useCallback(({ item }: { item: UnifiedChatMessage }) => {
    return <MessageItem item={item} />;
  }, []);

  const keyExtractor = useCallback((item: UnifiedChatMessage) => item.messageId, []);

  return (
    <View style={styles.container}>
      {chats.map((chat) => (
        <HiddenChatCollector key={chat.id} chat={chat} fontSize={fontSize} />
      ))}

      <View style={styles.header}>
        <Ionicons name="git-merge" size={16} color={Colors.dark.primary} />
        <Text style={styles.headerTitle}>Live Timeline</Text>
        <View style={styles.statsRow}>
          {chats.map((chat) => (
            <View key={chat.id} style={styles.sourceDot}>
              <View style={[styles.liveDot, { backgroundColor: platformColors[chat.platform] || Colors.dark.primary }]} />
              <Text style={styles.sourceText} numberOfLines={1}>{chat.name}</Text>
            </View>
          ))}
        </View>
        <View style={styles.headerSpacer} />
        <View style={styles.headerStats}>
          <Text style={styles.msgCount}>{messages.length}</Text>
        </View>
        <Pressable onPress={clearMessages} hitSlop={8} style={styles.headerBtn}>
          <Ionicons name="trash-outline" size={16} color={Colors.dark.textMuted} />
        </Pressable>
        <Pressable onPress={toggleAutoScroll} hitSlop={8} style={styles.headerBtn}>
          <Ionicons
            name={autoScroll ? "pause" : "play"}
            size={16}
            color={autoScroll ? Colors.dark.primary : Colors.dark.warning}
          />
        </Pressable>
      </View>

      {messages.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="radio-outline" size={40} color={Colors.dark.textMuted} />
          <Text style={styles.emptyTitle}>Waiting for messages...</Text>
          <Text style={styles.emptyDesc}>
            Messages from {chats.length} chat{chats.length !== 1 ? "s" : ""} will appear here in real time
          </Text>
          <View style={styles.sourcesPreview}>
            {chats.map((chat) => (
              <View key={chat.id} style={[styles.sourceChip, { borderColor: platformColors[chat.platform] || Colors.dark.primary }]}>
                <PlatformBadge platform={chat.platform} size={10} />
                <Text style={styles.sourceChipText} numberOfLines={1}>{chat.name}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={keyExtractor}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          showsVerticalScrollIndicator={false}
          initialNumToRender={30}
          maxToRenderPerBatch={20}
          windowSize={15}
          removeClippedSubviews={Platform.OS !== "web"}
        />
      )}

      {!autoScroll && messages.length > 0 && (
        <Pressable
          onPress={() => {
            setAutoScroll(true);
            flatListRef.current?.scrollToEnd({ animated: true });
          }}
          style={styles.scrollToBottomBtn}
        >
          <Ionicons name="arrow-down" size={16} color={Colors.dark.text} />
          <Text style={styles.scrollBtnText}>New messages</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.dark.borderLight,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.dark.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.borderLight,
    flexWrap: "wrap",
  },
  headerTitle: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
    flexShrink: 1,
  },
  sourceDot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sourceText: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
    maxWidth: 60,
  },
  headerSpacer: {
    flex: 1,
  },
  headerStats: {
    backgroundColor: Colors.dark.primary + "20",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  msgCount: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.primary,
  },
  headerBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
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
  sourcesPreview: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12,
    justifyContent: "center",
  },
  sourceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: Colors.dark.background,
  },
  sourceChipText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.textSecondary,
    maxWidth: 80,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    paddingVertical: 4,
  },
  messageRow: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderLeftWidth: 3,
    marginHorizontal: 4,
    marginVertical: 1,
    borderRadius: 4,
    backgroundColor: Colors.dark.background + "80",
  },
  messageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  platformDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  userName: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    flexShrink: 0,
  },
  chatOrigin: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
    flexShrink: 1,
    maxWidth: 100,
  },
  messageTime: {
    fontSize: 9,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textMuted,
    marginLeft: "auto" as any,
  },
  messageText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.text,
    lineHeight: 18,
    paddingLeft: 14,
  },
  scrollToBottomBtn: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.dark.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  scrollBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.background,
  },
});
