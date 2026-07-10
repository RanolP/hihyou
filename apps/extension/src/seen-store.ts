/**
 * Persistence for seen-state, keyed per PR. Uses extension storage when
 * available; falls back to localStorage (e.g. the dev-injected build).
 */

import type { PrLocation } from '@hihyou/github/pr-location';
import type { SeenState } from '@hihyou/diff-engine/seen-hunks';

export function prKey(pr: PrLocation): string {
  return `hihyou:seen:${pr.owner}/${pr.repo}#${pr.number}`;
}

interface ExtStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function extStorage(): ExtStorageArea | null {
  const g = globalThis as {
    browser?: { storage?: { local?: ExtStorageArea } };
    chrome?: { storage?: { local?: ExtStorageArea } };
  };
  return g.browser?.storage?.local ?? g.chrome?.storage?.local ?? null;
}

export async function loadSeenState(key: string): Promise<SeenState> {
  const ext = extStorage();
  if (ext) {
    const items = await ext.get(key);
    return (items[key] as SeenState | undefined) ?? {};
  }
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}');
  } catch {
    return {};
  }
}

export async function saveSeenState(
  key: string,
  state: SeenState,
): Promise<void> {
  const ext = extStorage();
  if (ext) {
    await ext.set({ [key]: state });
  } else {
    localStorage.setItem(key, JSON.stringify(state));
  }
}
