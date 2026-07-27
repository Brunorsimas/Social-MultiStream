import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const expand = require("../packages/brace-expansion-safe");

test("mantem as APIs legada e nomeada de brace-expansion", () => {
  assert.equal(typeof expand, "function");
  assert.equal(expand.expand, expand);
  assert.deepEqual(expand("file-{a,b}.txt"), ["file-a.txt", "file-b.txt"]);
  assert.deepEqual(expand("{1..3}"), ["1", "2", "3"]);
});

test("limita quantidade e tamanho acumulado das expansoes", () => {
  assert.equal(expand("{a,b,c}", { max: 2 }).length, 2);

  const startedAt = Date.now();
  const result = expand("{a,b}".repeat(300), {
    max: 100_000,
    maxLength: 10_000,
  });

  assert.ok(Date.now() - startedAt < 2_000);
  assert.ok(
    result.reduce((total, value) => total + value.length, 0) <= 10_000,
  );

  const proofOfConceptStartedAt = Date.now();
  const proofOfConcept = expand("{a,b}".repeat(1_500));
  assert.ok(Date.now() - proofOfConceptStartedAt < 2_000);
  assert.deepEqual(proofOfConcept, []);
  assert.ok(
    proofOfConcept.reduce((total, value) => total + value.length, 0) <=
      4_000_000,
  );

  const deepChainStartedAt = Date.now();
  assert.deepEqual(expand("{a,b}".repeat(3_000)), []);
  assert.ok(Date.now() - deepChainStartedAt < 2_000);
});

test("nao permite desativar os limites com valores infinitos", () => {
  const result = expand("{1..200000}", {
    max: Number.POSITIVE_INFINITY,
    maxLength: Number.POSITIVE_INFINITY,
  });
  assert.ok(result.length <= 100_000);
});
