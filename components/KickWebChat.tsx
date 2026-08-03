import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { getApiUrl } from "@/lib/api-url";
import { ThemeColors } from "@/constants/colors";
import { useChats } from "@/lib/chat-context";

interface KickMessage {
  id: string;
  userName: string;
  message: string;
  timestamp: number;
}

interface KickWebChatProps {
  channel: string;
  fontSize?: number;
}

export default function KickWebChat({ channel, fontSize = 14 }: KickWebChatProps) {
  const { themeColors } = useChats();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [messages, setMessages] = useState<KickMessage[]>([]);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addMessage = useCallback((msg: KickMessage) => {
    setMessages((prev) => {
      const already = prev.some((m) => m.id === msg.id);
      if (already) return prev;
      const next = [...prev, msg];
      if (next.length > 300) next.splice(0, next.length - 300);
      return next;
    });
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null;
      flatListRef.current?.scrollToEnd({ animated: false });
    }, 50);
  }, []);

  useEffect(() => {
    setMessages([]);
    setErrorMsg("");
    setStatus("connecting");
    if (!channel) {
      setStatus("error");
      setErrorMsg("Canal do Kick inválido");
      return;
    }

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const scheduleReconnect = (delay: number) => {
      if (!active) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    };

    function connect() {
      if (!active) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      es?.close();
      setStatus("connecting");
      try {
        const base = getApiUrl().replace(/\/$/, "");
        es = new EventSource(
          `${base}/api/kick/chat/${encodeURIComponent(channel)}`,
        );

        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === "connected" || data.type === "subscribed") {
              setStatus("connected");
            } else if (data.type === "message" && data.message) {
              addMessage({
                id: String(data.messageId),
                userName: data.userName || "Unknown",
                message: String(data.message),
                timestamp: data.timestamp || Date.now(),
              });
            } else if (data.type === "error") {
              es?.close();
              setStatus("error");
              setErrorMsg(data.message || "Erro ao conectar ao chat");
              if (data.retryable === true) {
                scheduleReconnect(15_000);
              }
            } else if (data.type === "disconnected") {
              es?.close();
              scheduleReconnect(3000);
            }
          } catch {}
        };

        es.onerror = () => {
          es?.close();
          if (active) {
            setStatus("connecting");
            scheduleReconnect(5000);
          }
        };
      } catch {
        setStatus("error");
        setErrorMsg("Servidor da API não configurado");
      }
    }

    connect();

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
      es?.close();
    };
  }, [channel, addMessage]);

  const renderItem = useCallback(
    ({ item }: { item: KickMessage }) => (
      <View style={styles.messageRow}>
        <Text style={[styles.userName, { fontSize }]} numberOfLines={1}>
          {item.userName}
          <Text style={[styles.colon, { fontSize }]}>: </Text>
        </Text>
        <Text style={[styles.messageText, { fontSize }]}>{item.message}</Text>
      </View>
    ),
    [fontSize, styles]
  );

  if (status === "connecting") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color={themeColors.kick} />
        <Text style={styles.statusText}>Conectando ao chat...</Text>
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{errorMsg || "Erro ao carregar chat"}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {messages.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.statusText}>Aguardando mensagens...</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={30}
          maxToRenderPerBatch={20}
          removeClippedSubviews={false}
        />
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.background,
  },
  statusText: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  errorText: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 16,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  messageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingVertical: 3,
  },
  userName: {
    color: colors.kick,
    fontFamily: "Inter_600SemiBold",
  },
  colon: {
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
  },
  messageText: {
    color: colors.text,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
});
