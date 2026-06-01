import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";

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
  const [messages, setMessages] = useState<KickMessage[]>([]);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const flatListRef = useRef<FlatList>(null);

  const addMessage = useCallback((msg: KickMessage) => {
    setMessages((prev) => {
      const already = prev.some((m) => m.id === msg.id);
      if (already) return prev;
      const next = [...prev, msg];
      if (next.length > 300) next.splice(0, next.length - 300);
      return next;
    });
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 50);
  }, []);

  useEffect(() => {
    if (!channel) return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const connect = () => {
      if (!active) return;
      setStatus("connecting");
      try {
        const base = getApiUrl().replace(/\/$/, "");
        es = new EventSource(`${base}/api/kick/chat/${channel}`);

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
              setStatus("error");
              setErrorMsg(data.message || "Erro ao conectar ao chat");
            } else if (data.type === "disconnected") {
              es?.close();
              if (active) retryTimer = setTimeout(connect, 3000);
            }
          } catch {}
        };

        es.onerror = () => {
          es?.close();
          if (active) {
            setStatus("connecting");
            retryTimer = setTimeout(connect, 5000);
          }
        };
      } catch {
        if (active) retryTimer = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
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
    [fontSize]
  );

  if (status === "connecting") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color={Colors.dark.kick} />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0A0F",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0A0A0F",
  },
  statusText: {
    color: Colors.dark.textMuted,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  errorText: {
    color: Colors.dark.textMuted,
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
    color: Colors.dark.kick,
    fontFamily: "Inter_600SemiBold",
  },
  colon: {
    color: Colors.dark.textMuted,
    fontFamily: "Inter_400Regular",
  },
  messageText: {
    color: Colors.dark.text,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
});
