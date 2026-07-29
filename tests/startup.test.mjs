import assert from "node:assert/strict";
import test from "node:test";

import {
  isAppStartupReady,
  STARTUP_FONT_TIMEOUT_MS,
} from "../lib/startup.ts";

test("não mantém o aplicativo preso quando as fontes não respondem", () => {
  assert.equal(isAppStartupReady(false, null, false), false);
  assert.equal(isAppStartupReady(true, null, false), true);
  assert.equal(isAppStartupReady(false, new Error("font"), false), true);
  assert.equal(isAppStartupReady(false, null, true), true);
  assert.ok(STARTUP_FONT_TIMEOUT_MS > 0);
  assert.ok(STARTUP_FONT_TIMEOUT_MS <= 10_000);
});
