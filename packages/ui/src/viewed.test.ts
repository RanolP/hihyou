import { expect, test } from "vitest";
import { atomViewed, writeAtoms } from "./atoms.js";
import {
  mergeScores,
  mergeViewed,
  plainKeyOf,
  type ScoreState,
  sessionScoreStore,
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

// Scores merged by arrival order instead of HLC would let replicas disagree, and a clear lose to the score it undid.
test("scores merge last-writer-wins: a later score wins, and a later clear wins over an earlier score", () => {
  const ahead = sessionScoreStore({ device: "ahead", now: () => 10_000 });
  const behind = sessionScoreStore({ device: "behind", now: () => 1_000 });
  ahead.setMany(["n1", "n2"], 2);
  behind.merge(ahead.state());
  behind.setMany(["n1"], -1);
  behind.setMany(["n2"], null);
  ahead.merge(behind.state());
  expect(ahead.get("n1")).toBe(-1);
  expect(ahead.get("n2")).toBe(null);
  expect(ahead.state()).toEqual(behind.state());
  const earlier: ScoreState = {
    n3: { score: 1, ts: { wall: 5, logical: 0 }, device: "x" },
  };
  const later: ScoreState = {
    n3: { score: null, ts: { wall: 6, logical: 0 }, device: "a" },
  };
  expect(mergeScores(earlier, later)).toEqual(later);
  expect(mergeScores(later, earlier)).toEqual(later);
});
