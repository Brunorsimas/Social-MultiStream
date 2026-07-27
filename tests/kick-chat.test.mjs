import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { bindSseLifecycle } from "../server/sse-lifecycle.ts";

test("mantem SSE ativo quando a requisicao HTTP termina de ser lida", () => {
  const req = new EventEmitter();
  const res = new EventEmitter();
  let disconnected = 0;

  bindSseLifecycle(req, res, () => {
    disconnected += 1;
  });

  req.emit("close");
  assert.equal(disconnected, 0);
});

test("encerra SSE quando o cliente aborta ou a resposta fecha", () => {
  const req = new EventEmitter();
  const res = new EventEmitter();
  let disconnected = 0;

  bindSseLifecycle(req, res, () => {
    disconnected += 1;
  });

  req.emit("aborted");
  assert.equal(disconnected, 1);

  const otherReq = new EventEmitter();
  const otherRes = new EventEmitter();
  bindSseLifecycle(otherReq, otherRes, () => {
    disconnected += 1;
  });
  otherRes.emit("close");
  assert.equal(disconnected, 2);
});
