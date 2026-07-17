import type { Request, Response } from "express";
import WebSocket from "ws";

const PUSHER_URL =
  "wss://ws-us3.pusher.com/app/dd11c46dae0376080879?protocol=7&client=js&version=7.6.0&flash=false";

async function getKickChatroomId(channel: string): Promise<number | null> {
  try {
    const response = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://kick.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Kick API returned HTTP ${response.status}`);
    const data = await response.json() as { chatroom?: { id?: number } };
    const id = data?.chatroom?.id;
    console.log(`[kick] Channel "${channel}" -> chatroomId: ${id}`);
    return id ?? null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[kick] Failed to get chatroom id for "${channel}": ${message}`);
    return null;
  }
}

export async function kickChatSSE(req: Request, res: Response): Promise<void> {
  const channel = (req.params.channel ?? "").toLowerCase().trim();
  if (!channel) {
    res.status(400).json({ error: "Missing channel name" });
    return;
  }
  if (!/^[a-z\d_]{1,40}$/.test(channel)) {
    res.status(400).json({ error: "Invalid channel name" });
    return;
  }

  const chatroomId = await getKickChatroomId(channel);
  if (!chatroomId) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`data: ${JSON.stringify({ type: "error", message: `Canal "${channel}" não encontrado no Kick` })}\n\n`);
    res.end();
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

  send({ type: "connected", chatroomId });
  console.log(`[kick] SSE connected for "${channel}" (chatroom ${chatroomId})`);

  let closed = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let ws: WebSocket;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (pingTimer) clearInterval(pingTimer);
    try { ws?.close(); } catch {}
  };

  try {
    ws = new WebSocket(PUSHER_URL);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[kick] WebSocket init failed: ${message}`);
    send({ type: "error", message: "Falha ao conectar ao WebSocket" });
    res.end();
    return;
  }

  ws.on("open", () => {
    console.log(`[kick] Pusher connected, subscribing to chatrooms.${chatroomId}.v2`);
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
        const content = String(d.content ?? "").trim();
        if (!content) return;
        send({
          type: "message",
          messageId: d.id ?? `${Date.now()}-${Math.random()}`,
          userName: d.sender?.username ?? "Unknown",
          userAvatar: d.sender?.profile_picture ?? d.sender?.profile_pic ?? null,
          message: content,
          timestamp: d.created_at
            ? new Date(d.created_at).getTime()
            : Date.now(),
        });
      } else if (msg.event === "pusher_internal:subscription_succeeded") {
        console.log(`[kick] Subscribed to chatrooms.${chatroomId}.v2`);
        send({ type: "subscribed", chatroomId });
      } else if (msg.event === "pusher:ping" && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "pusher:pong", data: {} }));
      } else if (msg.event === "pusher:error") {
        console.error(`[kick] Pusher error: ${JSON.stringify(msg.data)}`);
      }
    } catch {}
  });

  ws.on("error", (e) => {
    console.error(`[kick] WebSocket error: ${e.message}`);
    send({ type: "error", message: "Erro no WebSocket do Kick" });
  });

  ws.on("close", (code) => {
    console.log(`[kick] WebSocket closed: ${code}`);
    if (!closed) send({ type: "disconnected" });
    cleanup();
    try { res.end(); } catch {}
  });

  req.on("close", () => {
    console.log(`[kick] Client disconnected from SSE for "${channel}"`);
    cleanup();
  });
}
