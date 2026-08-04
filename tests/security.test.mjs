import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildContentSecurityPolicy,
  ConnectionLimiter,
  escapeHtml,
  normalizePublicHost,
  resolveClientAddress,
  resolvePublicOrigin,
} from "../server/security.ts";

test("escapa HTML dinâmico e gera CSP restrita por nonce", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('x')">`),
    "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;",
  );

  const policy = buildContentSecurityPolicy("test-nonce");
  assert.match(policy, /script-src 'nonce-test-nonce'/);
  assert.match(
    policy,
    /frame-ancestors 'self' https:\/\/replit\.com https:\/\/\*\.replit\.com https:\/\/\*\.replit\.dev/,
  );
  assert.doesNotMatch(policy, /script-src[^;]*(?:https:|unpkg|\*)/);
});

test("protege scripts e links externos da página inicial", () => {
  const template = readFileSync(
    new URL("../server/templates/landing-page.html", import.meta.url),
    "utf8",
  );
  const serverIndex = readFileSync(
    new URL("../server/index.ts", import.meta.url),
    "utf8",
  );

  assert.equal(
    template.match(/nonce="CSP_NONCE_PLACEHOLDER"/g)?.length,
    2,
  );
  assert.match(template, /QR_CODE_PLACEHOLDER/);
  assert.doesNotMatch(template, /unpkg|QRCodeStyling|<script[^>]+src=/);
  assert.doesNotMatch(serverIndex, /X-Frame-Options/);
  assert.equal(
    template.match(/rel="noopener noreferrer"/g)?.length,
    2,
  );
});

test("normaliza somente hosts seguros para uso no HTML", () => {
  assert.equal(normalizePublicHost("example.com:5000"), "example.com:5000");
  assert.equal(
    normalizePublicHost("https://app.example.com"),
    "app.example.com",
  );
  assert.equal(normalizePublicHost('attacker.test";alert(1);//'), null);
  assert.equal(normalizePublicHost("https://example.com/redirect"), null);
  assert.equal(normalizePublicHost("javascript://example.com"), null);
});

test("domínio configurado prevalece e headers host maliciosos são descartados", () => {
  assert.deepEqual(
    resolvePublicOrigin(
      "https://trusted.example",
      'attacker.test";alert(1);//',
      "https",
    ),
    {
      host: "trusted.example",
      origin: "https://trusted.example",
      protocol: "https",
    },
  );

  assert.deepEqual(
    resolvePublicOrigin(null, 'attacker.test";alert(1);//', "invalid"),
    {
      host: "localhost:5000",
      origin: "http://localhost:5000",
      protocol: "http",
    },
  );
});

test("limita conexões SSE simultâneas por cliente e libera a vaga", () => {
  const limiter = new ConnectionLimiter({
    maxActiveTotal: 3,
    maxActivePerKey: 1,
    maxAttemptsTotalPerWindow: 20,
    maxAttemptsPerWindow: 10,
    windowMs: 60_000,
  });

  const first = limiter.tryAcquire("client-a", 0);
  assert.equal(first.ok, true);
  assert.deepEqual(limiter.tryAcquire("client-a", 1), {
    ok: false,
    status: 429,
    retryAfterSeconds: 5,
    reason: "Too many active SSE connections",
  });

  if (first.ok) first.release();
  assert.equal(limiter.tryAcquire("client-a", 2).ok, true);
});

test("limita a capacidade SSE global", () => {
  const limiter = new ConnectionLimiter({
    maxActiveTotal: 1,
    maxActivePerKey: 1,
    maxAttemptsTotalPerWindow: 20,
    maxAttemptsPerWindow: 10,
    windowMs: 60_000,
  });

  assert.equal(limiter.tryAcquire("client-a", 0).ok, true);
  assert.deepEqual(limiter.tryAcquire("client-b", 1), {
    ok: false,
    status: 503,
    retryAfterSeconds: 5,
    reason: "SSE connection capacity reached",
  });
});

test("limita tentativas SSE dentro da janela e reinicia após expirar", () => {
  const limiter = new ConnectionLimiter({
    maxActiveTotal: 10,
    maxActivePerKey: 10,
    maxAttemptsTotalPerWindow: 20,
    maxAttemptsPerWindow: 2,
    windowMs: 1_000,
  });

  const first = limiter.tryAcquire("client-a", 0);
  const second = limiter.tryAcquire("client-a", 100);
  if (first.ok) first.release();
  if (second.ok) second.release();

  assert.deepEqual(limiter.tryAcquire("client-a", 200), {
    ok: false,
    status: 429,
    retryAfterSeconds: 1,
    reason: "Too many connection attempts",
  });
  assert.equal(limiter.tryAcquire("client-a", 1_000).ok, true);
});

test("limita globalmente as tentativas SSE, mesmo entre clientes diferentes", () => {
  const limiter = new ConnectionLimiter({
    maxActiveTotal: 10,
    maxActivePerKey: 10,
    maxAttemptsTotalPerWindow: 2,
    maxAttemptsPerWindow: 10,
    windowMs: 1_000,
  });

  assert.equal(limiter.tryAcquire("client-a", 0).ok, true);
  assert.equal(limiter.tryAcquire("client-b", 100).ok, true);
  assert.deepEqual(limiter.tryAcquire("client-c", 200), {
    ok: false,
    status: 429,
    retryAfterSeconds: 1,
    reason: "SSE connection attempt capacity reached",
  });
  assert.equal(limiter.tryAcquire("client-c", 1_000).ok, true);
});

test("usa o endereço público mais próximo do proxy e ignora o valor forjado", () => {
  assert.equal(
    resolveClientAddress(
      "10.0.0.5",
      "203.0.113.10, 198.51.100.20, 10.0.0.4",
    ),
    "198.51.100.20",
  );
  assert.equal(
    resolveClientAddress("198.51.100.30", "203.0.113.99"),
    "198.51.100.30",
  );
});
