import assert from "node:assert/strict";
import test from "node:test";

import {
  getYouTubeVideoIdExtractorScript,
  getYouTubeChatUrlFromMessage,
  parseYouTubeVideoIdMessage,
} from "../lib/youtube-webview.ts";

function createElement(attributes) {
  return {
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  };
}

function runExtractor({
  location = "https://www.youtube.com/@creator/live",
  playerResponse,
  query = {},
  scripts = [],
} = {}) {
  const posted = [];
  const scheduled = new Map();
  let nextTimer = 1;
  const fakeWindow = {
    location: { href: location },
    ReactNativeWebView: {
      postMessage(value) {
        posted.push(JSON.parse(value));
      },
    },
  };
  if (playerResponse) {
    fakeWindow.ytInitialPlayerResponse = playerResponse;
  }

  const fakeDocument = {
    querySelector(selector) {
      return query[selector] ?? null;
    },
    querySelectorAll(selector) {
      return selector === "script"
        ? scripts.map((textContent) => ({ textContent }))
        : [];
    },
  };
  const fakeSetTimeout = (callback) => {
    const timer = nextTimer++;
    scheduled.set(timer, callback);
    return timer;
  };
  const fakeClearTimeout = (timer) => {
    scheduled.delete(timer);
  };
  const execute = new Function(
    "window",
    "document",
    "setTimeout",
    "clearTimeout",
    getYouTubeVideoIdExtractorScript(
      "https://www.youtube.com/@creator/live?dark_theme=1",
    ),
  );

  execute(
    fakeWindow,
    fakeDocument,
    fakeSetTimeout,
    fakeClearTimeout,
  );

  return {
    fakeWindow,
    posted,
    runNextTimer() {
      const entry = scheduled.entries().next().value;
      if (!entry) return false;
      const [timer, callback] = entry;
      scheduled.delete(timer);
      callback();
      return true;
    },
    scheduledCount() {
      return scheduled.size;
    },
  };
}

test("extracts the active video id from YouTube player data", () => {
  const result = runExtractor({
    playerResponse: {
      videoDetails: {
        videoId: "abc123XYZ_-",
        isLiveContent: true,
      },
    },
  });

  assert.deepEqual(result.posted, [
    {
      type: "yt_video_id_resolved",
      videoId: "abc123XYZ_-",
      sourceUrl:
        "https://www.youtube.com/@creator/live?dark_theme=1",
    },
  ]);
  assert.equal(result.scheduledCount(), 0);
});

test("uses canonical metadata when @handle/live keeps its URL", () => {
  const result = runExtractor({
    query: {
      'link[rel="canonical"]': createElement({
        href: "https://www.youtube.com/watch?v=live123XYZ_",
      }),
    },
  });

  assert.equal(result.posted[0]?.videoId, "live123XYZ_");
});

test("selects the video nearest the live marker, not a recommendation", () => {
  const result = runExtractor({
    scripts: [
      [
        '{"videoId":"recommend01","title":"Recorded video"}',
        '{"videoId":"live123XYZ_","isLiveNow":true}',
      ].join(","),
    ],
  });

  assert.equal(result.posted[0]?.videoId, "live123XYZ_");
});

test("does not treat an unrelated recommended video as the live stream", () => {
  const result = runExtractor({
    scripts: ['{"videoId":"recommend01","title":"Recorded video"}'],
  });

  assert.deepEqual(result.posted, []);
  assert.equal(result.scheduledCount(), 1);
});

test("rejects explicitly recorded player data and inline canonical recommendations", () => {
  const recordedPlayer = runExtractor({
    playerResponse: {
      videoDetails: {
        videoId: "recorded01_",
        isLiveContent: false,
      },
    },
    scripts: [
      'var ytInitialPlayerResponse={"videoDetails":{"videoId":"recorded01_","isLiveContent":false}};',
    ],
  });
  const inlineRecommendation = runExtractor({
    scripts: [
      '{"canonicalUrl":"https://www.youtube.com/watch?v=recorded01_"}',
    ],
  });

  assert.deepEqual(recordedPlayer.posted, []);
  assert.deepEqual(inlineRecommendation.posted, []);
});

test("retries extraction when YouTube player data arrives after onLoadEnd", () => {
  const result = runExtractor();
  assert.deepEqual(result.posted, []);

  result.fakeWindow.ytInitialPlayerResponse = {
    videoDetails: {
      videoId: "late123XYZ_",
      isLiveContent: true,
    },
  };
  assert.equal(result.runNextTimer(), true);
  assert.equal(result.posted[0]?.videoId, "late123XYZ_");

  const executeAgain = new Function(
    "window",
    "document",
    getYouTubeVideoIdExtractorScript(
      "https://www.youtube.com/@creator/live?dark_theme=1",
    ),
  );
  executeAgain(result.fakeWindow, {
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  assert.equal(result.posted.length, 1);
});

test("validates bridge messages and only resolves an active handle page", () => {
  const message = JSON.stringify({
    type: "yt_video_id_resolved",
    videoId: "abc123XYZ_-",
    sourceUrl: "https://www.youtube.com/@creator/live?dark_theme=1",
  });

  assert.deepEqual(parseYouTubeVideoIdMessage(message), {
    videoId: "abc123XYZ_-",
    sourceUrl:
      "https://www.youtube.com/@creator/live?dark_theme=1",
  });
  assert.equal(
    getYouTubeChatUrlFromMessage(
      "https://www.youtube.com/@creator/live?dark_theme=1",
      message,
      "https://www.youtube.com/s/live-page",
    ),
    "https://www.youtube.com/live_chat?v=abc123XYZ_-&dark_theme=1&is_popout=1",
  );
  assert.equal(
    getYouTubeChatUrlFromMessage(
      "https://www.youtube.com/live_chat?v=abc123XYZ_-",
      message,
      "https://www.youtube.com/@creator/live",
    ),
    null,
  );
  assert.equal(
    getYouTubeChatUrlFromMessage(
      "https://www.youtube.com/@creator/live",
      message,
      "https://evil.example/@creator/live",
    ),
    null,
  );
  assert.equal(
    getYouTubeChatUrlFromMessage(
      "https://www.youtube.com/@creator/live",
      message,
      "https://www.youtube.com/@different/live",
    ),
    null,
  );
  assert.equal(
    getYouTubeChatUrlFromMessage(
      "https://www.youtube.com/@creator/live",
      JSON.stringify({
        type: "yt_video_id_resolved",
        videoId: "old123XYZ_-",
        sourceUrl: "https://www.youtube.com/@previous/live",
      }),
      "https://www.youtube.com/@creator/live",
    ),
    null,
  );

  for (const invalidMessage of [
    "not-json",
    JSON.stringify({ type: "chat_messages", videoId: "abc123XYZ_-" }),
    JSON.stringify({
      type: "yt_video_id_resolved",
      videoId: "invalid id",
      sourceUrl: "https://www.youtube.com/@creator/live",
    }),
  ]) {
    assert.equal(parseYouTubeVideoIdMessage(invalidMessage), null);
  }
});
