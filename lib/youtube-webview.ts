import {
  getYouTubeChatRedirect,
  getYouTubeChatTarget,
  isAllowedYouTubeChatNavigation,
} from "./chat-url.ts";

const YOUTUBE_VIDEO_ID_PATTERN = /^[a-z\d_-]{6,20}$/i;
const YOUTUBE_VIDEO_ID_MESSAGE_TYPE = "yt_video_id_resolved";
export const YOUTUBE_VIDEO_ID_RESOLUTION_TIMEOUT_MS = 12_000;

const YOUTUBE_EXPECTED_SOURCE_PLACEHOLDER =
  "__YOUTUBE_EXPECTED_SOURCE_URL__";

const YOUTUBE_VIDEO_ID_EXTRACTOR_TEMPLATE = String.raw`
(function() {
  var STATE_KEY = '__social_multichat_youtube_resolver';
  var SENT_KEY = '__social_multichat_youtube_resolved';
  var EXPECTED_SOURCE_URL = __YOUTUBE_EXPECTED_SOURCE_URL__;
  var bridge = window.ReactNativeWebView;

  if (!bridge || typeof bridge.postMessage !== 'function' || window[SENT_KEY]) {
    return;
  }

  var previousState = window[STATE_KEY];
  if (previousState && previousState.active) {
    return;
  }

  var state = {
    active: true,
    attempts: 0,
    timer: null,
    scannedScripts: typeof WeakSet === 'function' ? new WeakSet() : null
  };
  window[STATE_KEY] = state;

  function validVideoId(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{6,20}$/.test(value);
  }

  function videoIdFromUrl(value) {
    if (typeof value !== 'string' || !value) return null;

    var queryMatch = value.match(/[?&]v=([a-zA-Z0-9_-]{6,20})(?:[&#]|$)/);
    if (queryMatch && validVideoId(queryMatch[1])) return queryMatch[1];

    var pathMatch = value.match(/(?:youtu\.be\/|\/(?:live|embed|shorts)\/)([a-zA-Z0-9_-]{6,20})(?:[/?#&]|$)/);
    return pathMatch && validVideoId(pathMatch[1]) ? pathMatch[1] : null;
  }

  function readMetaUrl(selector) {
    var element = document.querySelector(selector);
    if (!element) return null;
    return videoIdFromUrl(
      element.getAttribute('href') ||
      element.getAttribute('content') ||
      ''
    );
  }

  function readPlayerResponse() {
    var response = window.ytInitialPlayerResponse;
    var videoDetails = response && response.videoDetails;
    if (videoDetails) {
      if (videoDetails.isLiveContent === false) return null;
      if (validVideoId(videoDetails.videoId)) return videoDetails.videoId;
    }

    var configuredArgs =
      window.ytplayer &&
      window.ytplayer.config &&
      window.ytplayer.config.args;
    if (!configuredArgs) return null;
    if (
      configuredArgs.livestream === '0' ||
      configuredArgs.is_live === '0' ||
      configuredArgs.is_live === false
    ) {
      return null;
    }
    return validVideoId(configuredArgs.video_id)
      ? configuredArgs.video_id
      : null;
  }

  function readDocumentData() {
    var videoIdElement = document.querySelector(
      'meta[itemprop="videoId"], [itemprop="videoId"][content]'
    );
    var itemPropId = videoIdElement && videoIdElement.getAttribute('content');
    if (validVideoId(itemPropId)) return itemPropId;

    var metaSelectors = [
      'link[rel="canonical"]',
      'meta[property="og:url"]',
      'meta[property="og:video:url"]',
      'meta[property="al:android:url"]',
      'meta[property="al:ios:url"]'
    ];
    for (var metaIndex = 0; metaIndex < metaSelectors.length; metaIndex++) {
      var metaId = readMetaUrl(metaSelectors[metaIndex]);
      if (metaId) return metaId;
    }

    var scripts = document.querySelectorAll('script');
    for (var scriptIndex = 0; scriptIndex < scripts.length; scriptIndex++) {
      var script = scripts[scriptIndex];
      if (state.scannedScripts && state.scannedScripts.has(script)) continue;
      if (state.scannedScripts) state.scannedScripts.add(script);

      var text = script.textContent || '';
      if (!text) continue;

      var playerMarker = text.indexOf('ytInitialPlayerResponse');
      if (playerMarker !== -1) {
        var playerData = text.slice(playerMarker, playerMarker + 500000);
        var detailsMarker = playerData.indexOf('"videoDetails"');
        var detailsData = detailsMarker === -1
          ? ''
          : playerData.slice(detailsMarker, detailsMarker + 10000);
        var isRecordedPlayer =
          /"isLiveContent"\s*:\s*false/.test(detailsData);
        if (!isRecordedPlayer) {
          var detailsMatch = detailsData.match(
            /"videoId"\s*:\s*"([a-zA-Z0-9_-]{6,20})"/
          );
          if (detailsMatch && validVideoId(detailsMatch[1])) {
            return detailsMatch[1];
          }

          var playerIdMatch = playerData.match(
            /"video_id"\s*:\s*"([a-zA-Z0-9_-]{6,20})"/
          );
          if (playerIdMatch && validVideoId(playerIdMatch[1])) {
            return playerIdMatch[1];
          }
        }
      }

      var liveMarkerMatch =
        /"(?:isLiveNow|isLiveContent)"\s*:\s*true/.exec(text);
      if (liveMarkerMatch && typeof liveMarkerMatch.index === 'number') {
        var liveData = text.slice(
          Math.max(0, liveMarkerMatch.index - 20000),
          liveMarkerMatch.index + 5000
        );
        var canonicalMatch = liveData.match(
          /"canonicalUrl"\s*:\s*"[^"]*(?:watch\?v=|\/live\/)([a-zA-Z0-9_-]{6,20})/
        );
        if (canonicalMatch && validVideoId(canonicalMatch[1])) {
          return canonicalMatch[1];
        }

        var beforeLiveData = text.slice(
          Math.max(0, liveMarkerMatch.index - 20000),
          liveMarkerMatch.index
        );
        var nearbyIdPattern =
          /"(?:externalVideoId|videoId)"\s*:\s*"([a-zA-Z0-9_-]{6,20})"/g;
        var nearbyIdMatch = null;
        var nextNearbyIdMatch;
        while ((nextNearbyIdMatch = nearbyIdPattern.exec(beforeLiveData))) {
          nearbyIdMatch = nextNearbyIdMatch;
        }
        if (nearbyIdMatch && validVideoId(nearbyIdMatch[1])) {
          return nearbyIdMatch[1];
        }

        var afterLiveData = text.slice(
          liveMarkerMatch.index,
          liveMarkerMatch.index + 5000
        );
        var afterLiveIdMatch = afterLiveData.match(
          /"(?:externalVideoId|videoId)"\s*:\s*"([a-zA-Z0-9_-]{6,20})"/
        );
        if (afterLiveIdMatch && validVideoId(afterLiveIdMatch[1])) {
          return afterLiveIdMatch[1];
        }
      }
    }

    return null;
  }

  function finish(videoId) {
    state.active = false;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (!validVideoId(videoId) || window[SENT_KEY]) return;
    window[SENT_KEY] = true;
    bridge.postMessage(JSON.stringify({
      type: 'yt_video_id_resolved',
      videoId: videoId,
      sourceUrl: EXPECTED_SOURCE_URL
    }));
  }

  function scan() {
    if (!state.active || window[SENT_KEY]) return;
    state.attempts += 1;

    var videoId =
      readPlayerResponse() ||
      videoIdFromUrl(window.location && window.location.href) ||
      readDocumentData();

    if (videoId) {
      finish(videoId);
      return;
    }

    if (state.attempts >= 20) {
      finish(null);
      return;
    }

    state.timer = setTimeout(scan, 500);
  }

  scan();
})();
true;
`;

export function getYouTubeVideoIdExtractorScript(
  expectedSourceUrl: string,
): string {
  const target = getYouTubeChatTarget(expectedSourceUrl);
  const safeSourceUrl =
    target?.type === "handle" ? expectedSourceUrl : "";

  return YOUTUBE_VIDEO_ID_EXTRACTOR_TEMPLATE.replace(
    YOUTUBE_EXPECTED_SOURCE_PLACEHOLDER,
    () => JSON.stringify(safeSourceUrl),
  );
}

export type YouTubeVideoIdMessage = {
  videoId: string;
  sourceUrl: string;
};

function isTrustedYouTubePageWithoutTarget(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const isYouTubeHost =
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com") ||
      hostname === "youtu.be" ||
      hostname.endsWith(".youtu.be");

    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      isYouTubeHost &&
      getYouTubeChatTarget(rawUrl) === null
    );
  } catch {
    return false;
  }
}

export function parseYouTubeVideoIdMessage(
  data: unknown,
): YouTubeVideoIdMessage | null {
  if (typeof data !== "string" || data.length > 2048) return null;

  try {
    const message: unknown = JSON.parse(data);
    if (
      typeof message !== "object" ||
      message === null ||
      Array.isArray(message)
    ) {
      return null;
    }

    const candidate = message as Record<string, unknown>;
    return candidate.type === YOUTUBE_VIDEO_ID_MESSAGE_TYPE &&
      typeof candidate.videoId === "string" &&
      YOUTUBE_VIDEO_ID_PATTERN.test(candidate.videoId) &&
      typeof candidate.sourceUrl === "string" &&
      candidate.sourceUrl.length <= 2048
      ? {
          videoId: candidate.videoId,
          sourceUrl: candidate.sourceUrl,
        }
      : null;
  } catch {
    return null;
  }
}

export function getYouTubeChatUrlFromMessage(
  currentSourceUrl: string,
  data: unknown,
  messageSourceUrl: unknown,
): string | null {
  const message = parseYouTubeVideoIdMessage(data);
  if (!message) return null;
  if (getYouTubeChatTarget(currentSourceUrl)?.type !== "handle") return null;
  if (
    !isAllowedYouTubeChatNavigation(
      message.sourceUrl,
      currentSourceUrl,
    )
  ) {
    return null;
  }
  if (
    typeof messageSourceUrl !== "string" ||
    (
      !isAllowedYouTubeChatNavigation(
        messageSourceUrl,
        currentSourceUrl,
      ) &&
      !isTrustedYouTubePageWithoutTarget(messageSourceUrl)
    )
  ) {
    return null;
  }

  return getYouTubeChatRedirect(
    currentSourceUrl,
    `https://www.youtube.com/watch?v=${encodeURIComponent(message.videoId)}`,
  );
}
