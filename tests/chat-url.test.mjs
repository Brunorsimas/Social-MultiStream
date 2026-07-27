import assert from "node:assert/strict";
import test from "node:test";
import { detectPlatform, getChatEmbedUrl, getKickChannelName, isResolvableChatUrl, normalizeChatUrl } from "../lib/chat-url.ts";
import {
  getKickScraper,
  getKickSocketInterceptor,
  getTwitchScraper,
  getYouTubeScraper,
} from "../lib/chat-scrapers.ts";

test("normalizes safe URLs and rejects active or credentialed URLs", () => {
  assert.equal(normalizeChatUrl("twitch.tv/example"), "https://www.twitch.tv/example/chat");
  assert.equal(normalizeChatUrl("javascript:alert(1)"), null);
  assert.equal(normalizeChatUrl("https://user:secret@example.com/chat"), null);
});

test("detects platforms by hostname instead of misleading text", () => {
  assert.equal(detectPlatform("https://www.youtube.com/watch?v=abc"), "youtube");
  assert.equal(detectPlatform("https://example.com/twitch.tv/channel"), "other");
});

test("builds supported Twitch and YouTube chat URLs", () => {
  assert.equal(
    getChatEmbedUrl("https://twitch.tv/example", "app.example.com"),
    "https://www.twitch.tv/embed/example/chat?parent=app.example.com&darkpopout",
  );
  assert.match(
    getChatEmbedUrl("https://youtu.be/video-id"),
    /^https:\/\/www\.youtube\.com\/live_chat\?/,
  );
});

test("extracts only valid Kick channel names", () => {
  assert.equal(getKickChannelName("https://kick.com/example_name"), "example_name");
  assert.equal(getKickChannelName("https://kick.com/not-valid!"), null);
  assert.equal(getKickChannelName("https://kick.com/categories"), null);
  assert.equal(getKickChannelName("https://kick.com/chat"), null);
  assert.equal(getKickChannelName("https://kick.com/login"), null);
});

test("builds the current Kick public chat route", () => {
  assert.equal(
    getChatEmbedUrl("https://kick.com/gaules"),
    "https://kick.com/gaules/chat",
  );
  assert.equal(
    getChatEmbedUrl("https://kick.com/gaules/chatroom"),
    "https://kick.com/gaules/chat",
  );
});

test("rejects known platform pages that cannot identify a chat", () => {
  assert.equal(isResolvableChatUrl("https://youtube.com/@creator", "youtube"), true);
  assert.equal(isResolvableChatUrl("https://youtube.com/live/video-id", "youtube"), true);
  assert.equal(isResolvableChatUrl("https://example.com/chat", "twitch"), false);
});

test("normalizes chat paths and @handles using the selected platform", () => {
  assert.equal(normalizeChatUrl("@gaules", "twitch"), "https://www.twitch.tv/gaules/chat");
  assert.equal(normalizeChatUrl("@gaules", "kick"), "https://kick.com/gaules/chat");
  assert.equal(normalizeChatUrl("@creator", "youtube"), "https://www.youtube.com/@creator/live");
  assert.equal(normalizeChatUrl("kick.com/@gaules/chat"), "https://kick.com/gaules/chat");
  assert.equal(normalizeChatUrl("twitch.tv/@gaules/chat"), "https://www.twitch.tv/gaules/chat");
  assert.equal(
    normalizeChatUrl("youtube.com/chat?v=video-id"),
    "https://www.youtube.com/live_chat?v=video-id",
  );
});

test("serializes user-provided chat metadata safely in scraper scripts", () => {
  const script = getTwitchScraper("chat-1", "O'Brien");
  assert.match(script, /var chatName = "O'Brien";/);
  assert.doesNotMatch(script, /chatName: 'O'Brien'/);
});

test("builds a resilient Kick collector without changing other platform scrapers", () => {
  const domScript = getKickScraper("kick-1", "Kick Chat");
  const socketScript = getKickSocketInterceptor("kick-1", "Kick Chat");
  const twitchScript = getTwitchScraper("twitch-1", "Twitch Chat");
  const youtubeScript = getYouTubeScraper("youtube-1", "YouTube Chat");

  assert.doesNotThrow(() => new Function(domScript));
  assert.doesNotThrow(() => new Function(socketScript));
  assert.doesNotThrow(() => new Function(twitchScript));
  assert.doesNotThrow(() => new Function(youtubeScript));
  assert.match(domScript, /subtree: true/);
  assert.match(domScript, /setInterval\(scanDocument, 3000\)/);
  assert.match(domScript, /data-testid="chat-message"/);
  assert.match(socketScript, /ChatMessage\(\?:Sent\)\?Event/);
  assert.match(socketScript, /window\.WebSocket = StreamChatWebSocket/);
  assert.match(socketScript, /type: 'chat_messages'/);
  assert.match(twitchScript, /subtree: true/);
  assert.match(twitchScript, /setInterval\(scanDocument, 3000\)/);
  assert.match(youtubeScript, /subtree: true/);
  assert.match(youtubeScript, /setInterval\(scanDocument, 3000\)/);
  assert.match(youtubeScript, /yt-live-chat-membership-item-renderer/);
});

test("forwards Kick websocket messages to the unified collector", () => {
  const posted = [];
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor() {
      this.listeners = new Map();
    }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }
    emit(type, data) {
      this.listeners.get(type)?.({ data });
    }
  }

  const fakeWindow = {
    WebSocket: FakeWebSocket,
    ReactNativeWebView: { postMessage: (value) => posted.push(JSON.parse(value)) },
  };
  const script = getKickSocketInterceptor("kick-1", "Kick Chat");
  new Function("window", script)(fakeWindow);

  const socket = new fakeWindow.WebSocket("wss://example.test");
  socket.emit("message", JSON.stringify({
    event: "App\\Events\\ChatMessageEvent",
    data: JSON.stringify({
      id: "message-1",
      content: "Mensagem da Kick",
      sender: { username: "viewer", profile_picture: "https://example.test/avatar.png" },
      created_at: "2026-07-23T12:00:00Z",
    }),
  }));

  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, "chat_messages");
  assert.deepEqual(posted[0].messages[0], {
    messageId: "kick-1_kk_message-1",
    platform: "kick",
    chatId: "kick-1",
    chatName: "Kick Chat",
    userName: "viewer",
    userAvatar: "https://example.test/avatar.png",
    message: "Mensagem da Kick",
    timestamp: Date.parse("2026-07-23T12:00:00Z"),
  });
});
