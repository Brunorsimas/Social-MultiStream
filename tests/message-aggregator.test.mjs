import assert from "node:assert/strict";
import test from "node:test";
import { MAX_MESSAGES, MessageAggregator } from "../lib/message-aggregator.ts";

function message(overrides = {}) {
  return {
    messageId: "message-1",
    platform: "youtube",
    chatId: "chat-1",
    chatName: "Main chat",
    userName: "Viewer",
    userAvatar: null,
    message: "Hello",
    timestamp: 1,
    ...overrides,
  };
}

test("sorts merged messages by timestamp", () => {
  const aggregator = new MessageAggregator();
  aggregator.addMessages([
    message({ messageId: "later", timestamp: 20 }),
    message({ messageId: "earlier", timestamp: 10 }),
  ]);
  assert.deepEqual(aggregator.getMessages().map((item) => item.messageId), ["earlier", "later"]);
});

test("deduplicates within a chat without hiding the same platform id from another chat", () => {
  const aggregator = new MessageAggregator();
  aggregator.addMessage(message());
  aggregator.addMessage(message());
  aggregator.addMessage(message({ chatId: "chat-2" }));
  assert.equal(aggregator.getMessages().length, 2);
});

test("keeps repeated message text when ids differ", () => {
  const aggregator = new MessageAggregator();
  aggregator.addMessage(message({ messageId: "first" }));
  aggregator.addMessage(message({ messageId: "second" }));
  assert.equal(aggregator.getMessages().length, 2);
});

test("retains only the newest 500 messages", () => {
  const aggregator = new MessageAggregator();
  aggregator.addMessages(Array.from({ length: MAX_MESSAGES + 25 }, (_, index) => message({
    messageId: `message-${index}`,
    timestamp: index + 1,
  })));
  const messages = aggregator.getMessages();
  assert.equal(messages.length, MAX_MESSAGES);
  assert.equal(messages[0].messageId, "message-25");
});

test("normalizes invalid values and notifies a new subscriber immediately", () => {
  const aggregator = new MessageAggregator();
  aggregator.addMessage(message({ platform: "invalid", timestamp: Number.NaN, message: "  hello  " }));
  let snapshot = [];
  const unsubscribe = aggregator.subscribe((messages) => { snapshot = messages; });
  unsubscribe();
  assert.equal(snapshot[0].platform, "unknown");
  assert.equal(snapshot[0].message, "hello");
  assert.ok(Number.isFinite(snapshot[0].timestamp));
});

