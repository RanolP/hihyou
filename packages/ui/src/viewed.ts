/**
 * "Viewed" state: which edit atoms (and, for code without an outline, move pairs and files) the reviewer has
 * looked at; a node, hunk or file reads viewed when every atom beneath it is (`atoms.ts`). Each replica (a device, later a gist)
 * holds a last-writer-wins element set, so two replicas merge into the same state in any order. A write's
 * timestamp comes from a hybrid logical clock, which never runs behind a timestamp it has seen: a device whose
 * wall clock is slow still writes after the entry it merged in, so an un-view made after seeing a view wins.
 */

/** A hybrid logical clock reading: wall-clock milliseconds, then a counter for events within one of them. */
export interface Hlc {
  wall: number;
  logical: number;
}

export const compareHlc = (a: Hlc, b: Hlc): number =>
  a.wall - b.wall || a.logical - b.logical;

export interface HybridClock {
  /** A reading for a local write, later than every reading this clock has made or received. */
  tick(): Hlc;
  /** Moves the clock past a reading from another replica. */
  receive(remote: Hlc): void;
}

export function hybridClock(now: () => number = Date.now): HybridClock {
  let last: Hlc = { wall: 0, logical: 0 };
  return {
    tick() {
      const wall = now();
      last =
        wall > last.wall
          ? { wall, logical: 0 }
          : { wall: last.wall, logical: last.logical + 1 };
      return last;
    },
    receive(remote) {
      if (compareHlc(remote, last) > 0) last = remote;
    },
  };
}

/** Un-viewing is an entry with `viewed: false`, so it can win over an earlier view on another replica. */
export interface ViewedEntry {
  viewed: boolean;
  ts: Hlc;
  /** The replica that wrote it; breaks a tie between equal timestamps. */
  device: string;
}

export type ViewedState = Readonly<Record<string, ViewedEntry>>;

/** Larger timestamp, then larger device; `viewed` only orders two copies of one malformed write. */
const newer = (a: ViewedEntry, b: ViewedEntry): ViewedEntry => {
  const c =
    compareHlc(a.ts, b.ts) ||
    (a.device === b.device ? 0 : a.device > b.device ? 1 : -1) ||
    Number(a.viewed) - Number(b.viewed);
  return c >= 0 ? a : b;
};

/** Per key, the newer entry: commutative, associative and idempotent. */
export function mergeViewed(a: ViewedState, b: ViewedState): ViewedState {
  const out: Record<string, ViewedEntry> = { ...a };
  for (const [key, entry] of Object.entries(b)) {
    const mine = out[key];
    out[key] = mine ? newer(mine, entry) : entry;
  }
  return out;
}

/**
 * Where viewed state lives. Stage 1 keeps it for the open review only; a persistent adapter (a gist) reads,
 * `merge`s and writes back `state()`.
 */
export interface ViewedStore {
  get(key: string): boolean;
  set(key: string, viewed: boolean): void;
  /** Writes every key at once, with one notification, so marking a whole file redraws once. */
  setMany(keys: readonly string[], viewed: boolean): void;
  /** Called after every change, local or merged in; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Folds another replica's state in. */
  merge(remote: ViewedState): void;
  state(): ViewedState;
}

export interface SessionStoreOptions {
  /** This replica's id; a random one when absent. */
  device?: string;
  now?: () => number;
}

export function sessionViewedStore(
  opts: SessionStoreOptions = {},
): ViewedStore {
  const device = opts.device ?? randomId();
  const clock = hybridClock(opts.now);
  let state: ViewedState = {};
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };
  const setMany = (keys: readonly string[], viewed: boolean) => {
    const next: Record<string, ViewedEntry> = { ...state };
    let changed = false;
    for (const key of keys) {
      if ((next[key]?.viewed ?? false) === viewed) continue;
      next[key] = { viewed, ts: clock.tick(), device };
      changed = true;
    }
    if (!changed) return;
    state = next;
    notify();
  };
  return {
    get: (key) => state[key]?.viewed ?? false,
    set: (key, viewed) => setMany([key], viewed),
    setMany,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    merge(remote) {
      for (const entry of Object.values(remote)) clock.receive(entry.ts);
      const next = mergeViewed(state, remote);
      const changed = Object.keys(next).some(
        (k) => next[k]?.viewed !== (state[k]?.viewed ?? false),
      );
      state = next;
      if (changed) notify();
    },
    state: () => state,
  };
}

const randomId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** One half of a move: where its lines are, and their text, so an edit to the moved code un-views it. */
export interface ViewedHalf {
  path: string;
  first: number;
  last: number;
  text: string;
}

/** What one "viewed" mark stands for. */
export type ViewedSubject =
  | {
      kind: "file";
      path: string;
      /** The file's blobs, so a new revision of it reads as unviewed again, as on GitHub. */
      before: string | null;
      after: string | null;
    }
  /** Both halves of a move share one subject, so viewing it in either file marks it in the other. */
  | { kind: "move"; before?: ViewedHalf; after?: ViewedHalf }
  /**
   * One edit atom, by the engine's id for it. Both halves of an update or a move carry the same id, so viewing
   * either half, in either file, marks the other.
   */
  | { kind: "atom"; atom: string };

/**
 * Turns a subject into the store's key. Every key goes through one of these, so a persistent store can swap in
 * a keyed hash and never hold a path.
 */
export type KeyOf = (subject: ViewedSubject) => string;

/** FNV-1a, for a short key out of a moved block's text; collisions only merge two marks. */
const fnv = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
};

/** A readable key for an in-session store. */
export const plainKeyOf: KeyOf = (s) => {
  if (s.kind === "file") return `file\0${s.path}\0${s.before}\0${s.after}`;
  if (s.kind === "atom") return `atom\0${s.atom}`;
  const half = (h?: ViewedHalf) =>
    h ? `${h.path}:${h.first}-${h.last}:${fnv(h.text)}` : "";
  return `move\0${half(s.before)}\0${half(s.after)}`;
};
