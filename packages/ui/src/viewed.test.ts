import { expect, test } from "vitest";
import { atomViewed, writeAtoms } from "./atoms.js";
import {
  mergeViewed,
  plainKeyOf,
  sessionViewedStore,
  type ViewedState,
} from "./viewed.js";

// Without the device tiebreak, two entries written in the same millisecond on two devices merge to whichever
// replica merged first, so the replicas never converge.
test("merge is commutative, associative and idempotent, ties broken by device", () => {
  const at = (wall: number, logical = 0) => ({ wall, logical });
  const a: ViewedState = {
    k1: { viewed: true, ts: at(5), device: "a" },
    k2: { viewed: false, ts: at(7, 1), device: "a" },
    k3: { viewed: true, ts: at(9), device: "a" },
  };
  const b: ViewedState = {
    k1: { viewed: false, ts: at(5), device: "b" },
    k2: { viewed: true, ts: at(7, 0), device: "b" },
    k4: { viewed: true, ts: at(1), device: "b" },
  };
  const c: ViewedState = {
    k1: { viewed: true, ts: at(4), device: "c" },
    k3: { viewed: false, ts: at(9), device: "c" },
  };
  expect(mergeViewed(a, b)).toEqual(mergeViewed(b, a));
  expect(mergeViewed(mergeViewed(a, b), c)).toEqual(
    mergeViewed(a, mergeViewed(b, c)),
  );
  expect(mergeViewed(a, a)).toEqual(a);
  const ab = mergeViewed(a, b);
  expect(mergeViewed(ab, b)).toEqual(ab);
  expect(ab["k1"]).toEqual(b["k1"]);
  expect(ab["k2"]).toEqual(a["k2"]);
});

// With wall-clock timestamps alone, a device whose clock runs behind writes its un-view "earlier" than the view
// it already saw, and the merge brings the view back on every replica.
test("a later un-view beats an earlier view across replicas with skewed wall clocks", () => {
  const ahead = sessionViewedStore({ device: "ahead", now: () => 10_000 });
  const behind = sessionViewedStore({ device: "behind", now: () => 1_000 });
  ahead.set("pair", true);
  behind.merge(ahead.state());
  expect(behind.get("pair")).toBe(true);
  behind.set("pair", false);
  ahead.merge(behind.state());
  behind.merge(ahead.state());
  expect(ahead.get("pair")).toBe(false);
  expect(behind.get("pair")).toBe(false);
  expect(ahead.state()).toEqual(behind.state());
});

// Each notification redraws the whole diff, so marking a file's atoms (or `%` then `v`) one write at a time
// redrew once per atom.
test("writing many atoms notifies once", () => {
  const store = sessionViewedStore();
  let calls = 0;
  store.subscribe(() => calls++);
  writeAtoms(["a", "b", "c"], true, store, plainKeyOf);
  expect(calls).toBe(1);
  expect(["a", "b", "c"].every(atomViewed(store, plainKeyOf))).toBe(true);
  writeAtoms(["a", "b", "c"], true, store, plainKeyOf);
  expect(calls).toBe(1);
});
