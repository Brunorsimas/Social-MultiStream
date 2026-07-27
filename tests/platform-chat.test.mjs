import assert from "node:assert/strict";
import test from "node:test";

import {
  getTwitchChannelName,
  getYouTubeChatTarget,
} from "../lib/chat-url.ts";
import { getWebChatEndpoint } from "../lib/web-chat-endpoint.ts";
import { parseTwitchPrivmsg } from "../server/twitch-chat.ts";
import {
  extractYouTubeContinuation,
  extractYouTubeMessages,
} from "../server/youtube-chat.ts";

test("builds web collectors for Twitch, YouTube and Kick", () => {
  assert.equal(
    getWebChatEndpoint({
      platform: "twitch",
      url: "https://www.twitch.tv/example/chat",
    }),
    "/api/twitch/chat/example",
  );
  assert.equal(
    getWebChatEndpoint({
      platform: "youtube",
      url: "https://www.youtube.com/watch?v=abc123XYZ_-",
    }),
    "/api/youtube/chat/video/abc123XYZ_-",
  );
  assert.equal(
    getWebChatEndpoint({
      platform: "youtube",
      url: "https://www.youtube.com/@example/live",
    }),
    "/api/youtube/chat/handle/example",
  );
  assert.equal(
    getWebChatEndpoint({
      platform: "kick",
      url: "https://kick.com/example/chat",
    }),
    "/api/kick/chat/example",
  );
});

test("extracts validated Twitch and YouTube targets", () => {
  assert.equal(
    getTwitchChannelName("https://www.twitch.tv/popout/example/chat"),
    "example",
  );
  assert.deepEqual(
    getYouTubeChatTarget(
      "https://www.youtube.com/live_chat?v=abc123XYZ_-",
    ),
    { type: "video", value: "abc123XYZ_-" },
  );
  assert.deepEqual(
    getYouTubeChatTarget("https://www.youtube.com/@example/live"),
    { type: "handle", value: "example" },
  );
});

test("parses Twitch IRC PRIVMSG tags and content", () => {
  const message = parseTwitchPrivmsg(
    "@badge-info=;badges=;display-name=Thor\\sFinn;color=#9147FF;id=msg-1;tmi-sent-ts=1770000000000 :thorfinn!thorfinn@thorfinn.tmi.twitch.tv PRIVMSG #example :teste Twitch",
  );

  assert.deepEqual(message, {
    messageId: "msg-1",
    userName: "Thor Finn",
    userAvatar: null,
    message: "teste Twitch",
    timestamp: 1770000000000,
  });
});

test("normalizes YouTube renderer messages and continuations", () => {
  const payload = {
    continuationContents: {
      liveChatContinuation: {
        actions: [
          {
            addChatItemAction: {
              item: {
                liveChatTextMessageRenderer: {
                  id: "yt-1",
                  authorName: { simpleText: "Maria" },
                  authorPhoto: {
                    thumbnails: [
                      { url: "https://yt.example/avatar.jpg" },
                    ],
                  },
                  message: {
                    runs: [
                      { text: "Olá " },
                      { emoji: { shortcuts: [":wave:"] } },
                    ],
                  },
                  timestampUsec: "1770000000000000",
                },
              },
            },
          },
          {
            addChatItemAction: {
              item: {
                liveChatViewerEngagementMessageRenderer: {
                  id: "system-1",
                  message: {
                    runs: [{ text: "Subscribers-only mode" }],
                  },
                },
              },
            },
          },
        ],
        continuations: [
          {
            timedContinuationData: {
              continuation: "next-token",
              timeoutMs: 2500,
            },
          },
        ],
      },
    },
  };

  assert.deepEqual(extractYouTubeMessages(payload), [
    {
      messageId: "yt-1",
      userName: "Maria",
      userAvatar: "https://yt.example/avatar.jpg",
      message: "Olá :wave:",
      timestamp: 1770000000000,
    },
  ]);
  assert.deepEqual(extractYouTubeContinuation(payload), {
    continuation: "next-token",
    timeoutMs: 2500,
  });
});
