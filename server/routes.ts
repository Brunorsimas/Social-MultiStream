import type { Express } from "express";
import { createServer, type Server } from "node:http";
import { kickChatSSE } from "./kick-chat";
import { twitchChatSSE } from "./twitch-chat";
import {
  youtubeHandleChatSSE,
  youtubeVideoChatSSE,
} from "./youtube-chat";

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/kick/chat/:channel", kickChatSSE);
  app.get("/api/twitch/chat/:channel", twitchChatSSE);
  app.get("/api/youtube/chat/video/:videoId", youtubeVideoChatSSE);
  app.get("/api/youtube/chat/handle/:handle", youtubeHandleChatSSE);

  const httpServer = createServer(app);

  return httpServer;
}
