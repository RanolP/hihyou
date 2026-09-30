import { expect, test } from "vitest";
import { createCache } from "./cache.js";

// A host that lowers preferences.cacheBytes under memory pressure must see the cache shrink, not keep its old size.
test("LRU drops its oldest entries at the next insert once cacheBytes is lowered", () => {
  let cap = 1000;
  const cache = createCache(() => cap);
  for (const key of ["a", "b", "c", "d"]) cache.set(key, key, 200);
  cache.get("a"); // "a" is now the most recent; "b" the oldest
  expect(cache.bytes).toBe(800);

  cap = 400;
  cache.set("e", "e", 200);

  expect(cache.bytes).toBeLessThanOrEqual(400);
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("c")).toBeUndefined();
  expect(cache.get("d")).toBeUndefined();
  expect(cache.get("a")).toBe("a");
  expect(cache.get("e")).toBe("e");
});
