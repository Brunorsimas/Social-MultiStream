import assert from "node:assert/strict";
import test from "node:test";
import { detectPlatform, getChatEmbedUrl, getKickChannelName, isResolvableChatUrl, normalizeChatUrl } from "../lib/chat-url.ts";
import { getTwitchScraper } from "../lib/chat-scrapers.ts";

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
});

test("rejects known platform pages that cannot identify a chat", () => {
  assert.equal(isResolvableChatUrl("https://youtube.com/@creator", "youtube"), true);
  assert.equal(isResolvableChatUrl("https://youtube.com/live/video-id", "youtube"), true);
  assert.equal(isResolvableChatUrl("https://example.com/chat", "twitch"), false);
});

test("normalizes chat paths and @handles using the selected platform", () => {
  assert.equal(normalizeChatUrl("@gaules", "twitch"), "https://www.twitch.tv/gaules/chat");
  assert.equal(normalizeChatUrl("@gaules", "kick"), "https://kick.com/gaules/chatroom");
  assert.equal(normalizeChatUrl("@creator", "youtube"), "https://www.youtube.com/@creator/live");
  assert.equal(normalizeChatUrl("kick.com/@gaules/chat"), "https://kick.com/gaules/chatroom");
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
