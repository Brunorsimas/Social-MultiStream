import assert from "node:assert/strict";
import test from "node:test";

import {
  getWebViewOriginWhitelist,
  isAllowedWebViewNavigation,
  normalizeCollectorEvent,
  normalizeWebViewUrl,
  shouldShareWebViewCookies,
} from "../lib/webview-security.ts";

test("restringe navegação aos domínios da plataforma", () => {
  assert.equal(
    isAllowedWebViewNavigation(
      "https://accounts.google.com/login",
      "https://www.youtube.com/live_chat?v=abc123",
      "youtube",
    ),
    true,
  );
  assert.equal(
    isAllowedWebViewNavigation(
      "https://phishing.example/login",
      "https://www.youtube.com/live_chat?v=abc123",
      "youtube",
    ),
    false,
  );
  assert.equal(
    isAllowedWebViewNavigation(
      "http://www.youtube.com/live_chat?v=abc123",
      "https://www.youtube.com/live_chat?v=abc123",
      "youtube",
    ),
    false,
  );
  assert.deepEqual(
    getWebViewOriginWhitelist(
      "https://www.youtube.com/live_chat?v=abc123",
      "youtube",
    ),
    ["*"],
  );
  assert.deepEqual(
    getWebViewOriginWhitelist(
      "https://www.twitch.tv/example/chat",
      "twitch",
    ),
    ["https://twitch.tv/*", "https://*.twitch.tv/*"],
  );
  assert.equal(
    isAllowedWebViewNavigation(
      "https://fb.watch/example",
      "https://fb.watch/example",
      "facebook",
    ),
    true,
  );
  assert.deepEqual(
    getWebViewOriginWhitelist(
      "https://fb.watch/example",
      "facebook",
    ),
    [
      "https://facebook.com/*",
      "https://*.facebook.com/*",
      "https://fb.com/*",
      "https://*.fb.com/*",
      "https://fb.watch/*",
      "https://*.fb.watch/*",
    ],
  );
  assert.equal(
    isAllowedWebViewNavigation(
      "https://www.facebook.com/watch/live/example",
      "https://fb.watch/example",
      "facebook",
    ),
    true,
  );
  assert.equal(
    isAllowedWebViewNavigation(
      "https://fb.watch/example",
      "https://www.facebook.com/watch/live/example",
      "facebook",
    ),
    true,
  );
});

test("mantém canais personalizados restritos à origem configurada", () => {
  assert.equal(
    isAllowedWebViewNavigation(
      "https://chat.example.com/room/2",
      "https://chat.example.com/room/1",
      "other",
    ),
    true,
  );
  assert.equal(
    isAllowedWebViewNavigation(
      "https://login.example.net/",
      "https://chat.example.com/room/1",
      "other",
    ),
    false,
  );
  assert.deepEqual(
    getWebViewOriginWhitelist("https://chat.example.com/room", "other"),
    ["https://chat.example.com/*"],
  );
});

test("compartilha cookies somente com plataformas HTTPS conhecidas", () => {
  assert.equal(
    shouldShareWebViewCookies("https://kick.com/channel/chat", "kick"),
    true,
  );
  assert.equal(
    shouldShareWebViewCookies("https://chat.example.com", "other"),
    false,
  );
  assert.equal(normalizeWebViewUrl("javascript:alert(1)"), null);
});

test("normaliza e limita mensagens recebidas pela ponte WebView", () => {
  const messages = Array.from({ length: 55 }, (_, index) => ({
    messageId: `message-${index}`,
    chatId: "forged-chat",
    chatName: "Forged chat",
    platform: "forged",
    userName: "u".repeat(100),
    userAvatar: "http://insecure.example/avatar.png",
    message: "m".repeat(4_100),
    timestamp: 123,
  }));

  const normalized = normalizeCollectorEvent(
    JSON.stringify({ type: "chat_messages", messages }),
    "https://kick.com/channel/chat",
    "https://kick.com/channel/chat",
    {
      id: "trusted-chat",
      name: "Trusted chat",
      platform: "kick",
    },
  );

  assert.equal(normalized.length, 50);
  assert.equal(normalized[0].chatId, "trusted-chat");
  assert.equal(normalized[0].chatName, "Trusted chat");
  assert.equal(normalized[0].platform, "kick");
  assert.equal(normalized[0].userName.length, 80);
  assert.equal(normalized[0].message.length, 4_000);
  assert.equal(normalized[0].userAvatar, null);
});

test("rejeita mensagens originadas fora da plataforma", () => {
  assert.deepEqual(
    normalizeCollectorEvent(
      JSON.stringify({
        type: "chat_messages",
        messages: [{ messageId: "1", message: "hello" }],
      }),
      "https://www.twitch.tv/channel/chat",
      "https://evil.example/chat",
      { id: "chat", name: "Chat", platform: "twitch" },
    ),
    [],
  );
  assert.deepEqual(
    normalizeCollectorEvent(
      JSON.stringify({
        type: "chat_messages",
        messages: [{ messageId: "1", message: "hello" }],
      }),
      "https://www.youtube.com/live_chat?v=abc123",
      "https://accounts.google.com/login",
      { id: "chat", name: "Chat", platform: "youtube" },
    ),
    [],
  );
});
