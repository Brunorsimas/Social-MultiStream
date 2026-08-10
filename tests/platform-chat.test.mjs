import assert from "node:assert/strict";
import test from "node:test";

import {
  getYouTubeChatRedirect,
  getTwitchChannelName,
  getYouTubeChatTarget,
  isAllowedYouTubeChatNavigation,
  isYouTubeLiveChatUrl,
  shouldIgnoreYouTubeLoadEnd,
} from "../lib/chat-url.ts";
import {
  getWebChatEndpoint,
  shouldRetryWebChatError,
} from "../lib/web-chat-endpoint.ts";
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

test("stops reconnecting when a web chat error is permanent", () => {
  assert.equal(shouldRetryWebChatError({ retryable: false }), false);
  assert.equal(shouldRetryWebChatError({ retryable: true }), true);
  assert.equal(shouldRetryWebChatError({ type: "error" }), true);
  assert.equal(shouldRetryWebChatError(null), true);
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

test("redirects a YouTube channel live page to the embedded live chat", () => {
  const channelUrl = "https://www.youtube.com/@example/live?dark_theme=1";
  const watchUrl = "https://www.youtube.com/watch?v=abc123XYZ_-";
  assert.equal(
    getYouTubeChatRedirect(channelUrl, watchUrl),
    "https://www.youtube.com/live_chat?v=abc123XYZ_-&dark_theme=1&is_popout=1",
  );
  assert.equal(
    getYouTubeChatRedirect(
      "https://www.youtube.com/live_chat?v=abc123XYZ_-&dark_theme=1&is_popout=1",
      "intent://watch?v=abc123XYZ_-",
    ),
    null,
  );
  assert.equal(
    getYouTubeChatRedirect(
      "https://www.youtube.com/@example/live?dark_theme=1",
      "intent://watch?v=abc123XYZ_-#Intent;scheme=https;package=com.google.android.youtube;end",
    ),
    "https://www.youtube.com/live_chat?v=abc123XYZ_-&dark_theme=1&is_popout=1",
  );
  assert.equal(
    getYouTubeChatRedirect(
      "https://www.youtube.com/@example/live?dark_theme=1",
      "vnd.youtube://AbC123XYZ_-",
    ),
    "https://www.youtube.com/live_chat?v=AbC123XYZ_-&dark_theme=1&is_popout=1",
  );
  assert.equal(
    getYouTubeChatRedirect(
      "https://www.youtube.com/live_chat?v=abc123XYZ_-&dark_theme=1&is_popout=1",
      "https://www.youtube.com/watch?v=different1",
    ),
    null,
  );
  assert.equal(
    isYouTubeLiveChatUrl(
      "https://www.youtube.com/live_chat?v=abc123XYZ_-&is_popout=1",
    ),
    true,
  );
  assert.equal(
    isYouTubeLiveChatUrl("https://www.youtube.com/@example/live"),
    false,
  );
});

test("keeps the YouTube WebView restricted to the internal chat", () => {
  const liveChatUrl =
    "https://www.youtube.com/live_chat?v=abc123XYZ_-&is_popout=1";
  assert.equal(
    isAllowedYouTubeChatNavigation(liveChatUrl, liveChatUrl),
    true,
  );
  assert.equal(
    isAllowedYouTubeChatNavigation(
      "https://www.youtube.com/@Example/live",
      "https://www.youtube.com/@example/live?dark_theme=1",
    ),
    true,
  );
  assert.equal(
    isAllowedYouTubeChatNavigation(
      "https://www.youtube.com/watch?v=abc123XYZ_-",
      liveChatUrl,
    ),
    false,
  );
  assert.equal(
    isAllowedYouTubeChatNavigation(
      "https://www.youtube.com/live_chat?v=different1",
      liveChatUrl,
    ),
    false,
  );
  assert.equal(
    isAllowedYouTubeChatNavigation(
      "https://www.youtube.com/@example/videos",
      "https://www.youtube.com/@example/live?dark_theme=1",
    ),
    false,
  );
  assert.equal(
    isAllowedYouTubeChatNavigation(
      "https://accounts.google.com/login",
      liveChatUrl,
    ),
    false,
  );
  assert.equal(
    isAllowedYouTubeChatNavigation(
      "intent://watch?v=abc123XYZ_-",
      liveChatUrl,
    ),
    false,
  );
  assert.equal(
    isAllowedYouTubeChatNavigation(
      "youtube://watch?v=abc123XYZ_-",
      liveChatUrl,
    ),
    false,
  );
  assert.equal(
    isAllowedYouTubeChatNavigation(
      "vnd.youtube://abc123XYZ_-",
      liveChatUrl,
    ),
    false,
  );
  for (const externalUrl of [
    "market://details?id=com.google.android.youtube",
    "tel:+5511999999999",
    "mailto:test@example.com",
    "data:text/html,blocked",
  ]) {
    assert.equal(
      isAllowedYouTubeChatNavigation(externalUrl, liveChatUrl),
      false,
    );
  }
});

test("ignores stale YouTube load events after resolving the live chat", () => {
  const liveChatUrl =
    "https://www.youtube.com/live_chat?v=abc123XYZ_-&is_popout=1";
  assert.equal(
    shouldIgnoreYouTubeLoadEnd(
      liveChatUrl,
      "https://www.youtube.com/@example/live",
    ),
    true,
  );
  assert.equal(
    shouldIgnoreYouTubeLoadEnd(
      liveChatUrl,
      "https://www.youtube.com/live_chat?v=different1",
    ),
    true,
  );
  assert.equal(
    shouldIgnoreYouTubeLoadEnd(liveChatUrl, liveChatUrl),
    false,
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

test("uses the Twitch Shared Chat source id as the canonical message id", () => {
  const message = parseTwitchPrivmsg(
    "@display-name=Thor;id=room-copy-id;source-id=original-message-id;source-room-id=12826;tmi-sent-ts=1770000000000 :thor!thor@thor.tmi.twitch.tv PRIVMSG #sharedchannel :mensagem compartilhada",
  );

  assert.equal(message?.messageId, "original-message-id");
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
