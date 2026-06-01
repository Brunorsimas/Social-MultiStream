import { Request, Response } from "express";
import WebSocket from "ws";

const PUSHER_URL =
  "wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=7.6.0&flash=false";

async function getKickChatroomId(channel: string): Promise<number | null> {
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${channel}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://kick.com/",
      },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.chatroom?.id ?? null;
  } catch {
    return null;
  }
}

export async function kickChatSSE(req: Request, res: Response): Promise<void> {
  const channel = (req.params.channel ?? "").toLowerCase().trim();
  if (!channel) {
    res.status(400).json({ error: "Missing channel name" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (payload: object) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {}
  };

  const chatroomId = await getKickChatroomId(channel);
  if (!chatroomId) {
    send({ type: "error", message: `Canal "${channel}" não encontrado no Kick` });
    res.end();
    return;
  }

  send({ type: "connected", chatroomId });

  let ws: WebSocket;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (pingTimer) clearInterval(pingTimer);
    try { ws?.close(); } catch {}
  };

  try {
    ws = new WebSocket(PUSHER_URL);
  } catch {
    send({ type: "error", message: "Falha ao conectar ao WebSocket" });
    res.end();
    return;
  }

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        event: "pusher:subscribe",
        data: { auth: "", channel: `chatrooms.${chatroomId}.v2` },
      })
    );
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "pusher:ping", data: {} }));
      }
    }, 25000);
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.event === "App\\Events\\ChatMessageEvent") {
        const d =
          typeof msg.data === "string" ? JSON.parse(msg.data) : msg.data;
        const content = (d.content ?? "").trim();
        if (!content) return;
        send({
          type: "message",
          messageId: d.id ?? `${Date.now()}-${Math.random()}`,
          userName: d.sender?.username ?? "Unknown",
          message: content,
          timestamp: d.created_at
            ? new Date(d.created_at).getTime()
            : Date.now(),
        });
      }
    } catch {}
  });

  ws.on("error", () => {
    send({ type: "error", message: "Erro no WebSocket do Kick" });
  });

  ws.on("close", () => {
    if (!closed) send({ type: "disconnected" });
    cleanup();
    try { res.end(); } catch {}
  });

  req.on("close", () => {
    cleanup();
  });
}
