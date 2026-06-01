import type { Express } from "express";
import { createServer, type Server } from "node:http";
import { kickChatSSE } from "./kick-chat";

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/kick/chat/:channel", kickChatSSE);

  const httpServer = createServer(app);

  return httpServer;
}
