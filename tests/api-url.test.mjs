import assert from "node:assert/strict";
import test from "node:test";

import { getApiUrl } from "../lib/api-url.ts";

function withPublicDomain(value, callback) {
  const previous = process.env.EXPO_PUBLIC_DOMAIN;
  if (value === undefined) {
    delete process.env.EXPO_PUBLIC_DOMAIN;
  } else {
    process.env.EXPO_PUBLIC_DOMAIN = value;
  }

  try {
    callback();
  } finally {
    if (previous === undefined) {
      delete process.env.EXPO_PUBLIC_DOMAIN;
    } else {
      process.env.EXPO_PUBLIC_DOMAIN = previous;
    }
  }
}

test("normaliza a origem configurada da API", () => {
  withPublicDomain("api.example.test", () => {
    assert.equal(getApiUrl(), "https://api.example.test/");
  });
  withPublicDomain("localhost:5000", () => {
    assert.equal(getApiUrl(), "http://localhost:5000/");
  });
  withPublicDomain("[::1]:5000", () => {
    assert.equal(getApiUrl(), "http://[::1]:5000/");
  });
});

test("rejeita configuração inválida sem redirecionar para localhost", () => {
  for (const invalidDomain of [
    "https://",
    "https,...",
    "ftp://example.test",
    "https://user:secret@example.test",
    "https://example.test/api",
    "https://example.test?query=1",
    "https://example.test#fragment",
    "example.test/api",
    "example.test,other.test",
    "-invalid.example.test",
  ]) {
    withPublicDomain(invalidDomain, () => {
      assert.throws(
        () => getApiUrl(),
        /API origin unavailable/,
      );
    });
  }
});
