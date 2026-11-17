import { test } from "node:test";
import assert from "node:assert/strict";
import { PromiseCache } from "../src/lib/cache.ts";

test("shares in-flight promises and caches results", async () => {
  const cache = new PromiseCache<number>(10);
  let calls = 0;
  const factory = async () => ++calls;
  const [a, b] = await Promise.all([cache.getOrCreate("k", 1000, factory), cache.getOrCreate("k", 1000, factory)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(await cache.getOrCreate("k", 1000, factory), 1);
  assert.equal(calls, 1);
});

test("does not cache failures", async () => {
  const cache = new PromiseCache<number>(10);
  await assert.rejects(cache.getOrCreate("k", 1000, async () => { throw new Error("boom"); }));
  await new Promise((r) => setImmediate(r));
  assert.equal(await cache.getOrCreate("k", 1000, async () => 7), 7);
});

test("expires entries and evicts least recently used", async () => {
  const cache = new PromiseCache<string>(2);
  await cache.getOrCreate("old", -1, async () => "stale");
  assert.equal(await cache.getOrCreate("old", 1000, async () => "fresh"), "fresh");
  await cache.getOrCreate("a", 1000, async () => "a");
  await cache.getOrCreate("old", 1000, async () => "x"); // touch "old"
  await cache.getOrCreate("b", 1000, async () => "b"); // evicts "a"
  assert.equal(cache.size, 2);
  assert.equal(await cache.getOrCreate("a", 1000, async () => "a2"), "a2");
});
