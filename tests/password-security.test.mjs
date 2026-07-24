import assert from "node:assert/strict";
import test from "node:test";

import {
  hashPassword,
  verifyPassword,
} from "../server/password-security.ts";

test("hashPassword never stores the original password", async () => {
  const password = "uma-senha-bem-forte";
  const hash = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.match(hash, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(await verifyPassword(password, hash), true);
});

test("verifyPassword rejects an incorrect password", async () => {
  const hash = await hashPassword("senha-correta-123");

  assert.equal(await verifyPassword("senha-incorreta-123", hash), false);
});

test("verifyPassword rejects malformed stored values", async () => {
  assert.equal(await verifyPassword("qualquer-senha", "texto-puro"), false);
  assert.equal(await verifyPassword("qualquer-senha", "scrypt$aa$bb"), false);
});
