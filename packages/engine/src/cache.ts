export const defaultCacheBytes = 256 * 1024 * 1024;

/**
 * One byte-sized LRU for everything the engine computes. Its cap is re-read on every insert, so a host
 * that lowers `preferences.cacheBytes` sees memory shrink at the next insert. Losing an entry costs only
 * the time to recompute it.
 */
export interface Cache {
  /** Total estimated bytes held. */
  readonly bytes: number;
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown, bytes: number): void;
  /**
   * The cached value, or `compute`'s result stored at `bytesOf(result)`. Concurrent callers for one key
   * share a single computation.
   */
  through<T>(
    key: string,
    compute: () => T | Promise<T>,
    bytesOf: (value: T) => number,
  ): Promise<T>;
}

export const cacheKey = {
  resolve: (data: unknown) => `resolve\0${JSON.stringify(data)}`,
  blob: (id: string) => `blob\0${id}`,
  tree: (id: string, grammar: string) => `tree\0${id}\0${grammar}`,
  formatted: (id: string, grammar: string) => `fmt\0${id}\0${grammar}`,
  diff: (diffsetId: string) => `diff\0${diffsetId}`,
  interdiff: (from: string, to: string) => `interdiff\0${from}\0${to}`,
};

export function createCache(cap: () => number | undefined): Cache {
  const entries = new Map<string, { value: unknown; bytes: number }>();
  const pending = new Map<string, Promise<unknown>>();
  let total = 0;

  const cache: Cache = {
    get bytes() {
      return total;
    },
    get<T>(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      // Re-inserting moves the key to the newest end of the Map's insertion order.
      entries.delete(key);
      entries.set(key, entry);
      return entry.value as T;
    },
    set(key, value, bytes) {
      const old = entries.get(key);
      if (old) {
        total -= old.bytes;
        entries.delete(key);
      }
      entries.set(key, { value, bytes });
      total += bytes;
      const limit = cap() ?? defaultCacheBytes;
      for (const [k, entry] of entries) {
        if (total <= limit) break;
        entries.delete(k);
        total -= entry.bytes;
      }
    },
    async through<T>(
      key: string,
      compute: () => T | Promise<T>,
      bytesOf: (value: T) => number,
    ): Promise<T> {
      if (entries.has(key)) return cache.get<T>(key) as T;
      const running = pending.get(key);
      if (running) return running as Promise<T>;
      const promise = (async () => {
        try {
          const value = await compute();
          cache.set(key, value, bytesOf(value));
          return value;
        } finally {
          pending.delete(key);
        }
      })();
      pending.set(key, promise);
      return promise;
    },
  };
  return cache;
}
