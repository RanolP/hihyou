/**
 * Content-script client for the background AST service. Degrades to null
 * when the service worker isn't reachable (e.g. the injected dev build).
 */

import { astMessaging } from './ast-rpc';
import type {
  DeclHashInfo,
  FileAnalysis,
  LineRange,
  SemanticHunk,
} from './ast-service';
import { grammarForPath } from './ast-service';
import { fetchRawBlob } from './github-changes';

let backendDead = false;
const analyses = new Map<string, Promise<FileAnalysis | null>>();

export function analyzeFile(
  path: string,
  text: string,
): Promise<FileAnalysis | null> {
  if (backendDead || !grammarForPath(path)) return Promise.resolve(null);
  const key = `${path}:${text.length}`;
  let result = analyses.get(key);
  if (!result) {
    result = astMessaging
      .sendMessage('parseFile', { path, text })
      .catch(() => {
        backendDead = true;
        return null;
      });
    analyses.set(key, result);
  }
  return result;
}

const MAX_BLOB = 400_000;
const blobAnalyses = new Map<string, Promise<FileAnalysis | null>>();

/** Analyze a file's new-side blob at a commit, cached per oid+path. */
export function analyzeBlob(
  owner: string,
  repo: string,
  oid: string,
  path: string,
): Promise<FileAnalysis | null> {
  // Dev seam: seeded analyses stand in for the SW backend in page-injected
  // builds (WASM is CSP-blocked there).
  const seeded = (
    globalThis as { __hihyouSeededAnalyses?: Record<string, FileAnalysis> }
  ).__hihyouSeededAnalyses?.[path];
  if (seeded) return Promise.resolve(seeded);
  if (backendDead || !grammarForPath(path)) return Promise.resolve(null);
  const key = `${oid}:${path}`;
  let result = blobAnalyses.get(key);
  if (!result) {
    result = fetchRawBlob(owner, repo, oid, path).then((text) =>
      text && text.length <= MAX_BLOB ? analyzeFile(path, text) : null,
    );
    blobAnalyses.set(key, result);
  }
  return result;
}

const declHashCache = new Map<string, Promise<DeclHashInfo[] | null>>();

/** Top-level declaration hashes for a blob (moved-code detection). */
export function declHashesBlob(
  owner: string,
  repo: string,
  oid: string,
  path: string,
): Promise<DeclHashInfo[] | null> {
  const seeded = (
    globalThis as {
      __hihyouSeededDeclHashes?: Record<string, DeclHashInfo[]>;
    }
  ).__hihyouSeededDeclHashes?.[`${oid}:${path}`];
  if (seeded) return Promise.resolve(seeded);
  if (backendDead || !grammarForPath(path)) return Promise.resolve(null);
  const key = `${oid}:${path}`;
  let result = declHashCache.get(key);
  if (!result) {
    result = fetchRawBlob(owner, repo, oid, path).then((text) =>
      text && text.length <= MAX_BLOB
        ? astMessaging.sendMessage('declHashes', { path, text }).catch(() => {
            backendDead = true;
            return null;
          })
        : null,
    );
    declHashCache.set(key, result);
  }
  return result;
}

const blobTextCache = new Map<string, Promise<string | null>>();

function blobText(
  owner: string,
  repo: string,
  oid: string,
  path: string,
): Promise<string | null> {
  const key = `${oid}:${path}`;
  let p = blobTextCache.get(key);
  if (!p) {
    p = fetchRawBlob(owner, repo, oid, path);
    blobTextCache.set(key, p);
  }
  return p;
}

/** Tiniest multiline node at a position of the new-side blob. */
export async function pickNodeAt(
  owner: string,
  repo: string,
  oid: string,
  path: string,
  line: number,
  col: number,
): Promise<LineRange | null> {
  if (backendDead || !grammarForPath(path)) return null;
  const text = await blobText(owner, repo, oid, path);
  if (!text || text.length > MAX_BLOB) return null;
  return astMessaging
    .sendMessage('pickNode', { path, text, line, col })
    .catch(() => {
      backendDead = true;
      return null;
    });
}

/** Really apply a unified diff via the local daemon (through the SW). */
export async function applyPatchLocally(
  patch: string,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    return await astMessaging.sendMessage('applyPatch', { patch });
  } catch {
    return { ok: false, detail: 'extension backend unavailable' };
  }
}

export function structuralDiff(
  path: string,
  oldText: string,
  newText: string,
): Promise<SemanticHunk[] | null> {
  if (backendDead || !grammarForPath(path)) return Promise.resolve(null);
  return astMessaging
    .sendMessage('structuralDiff', { path, oldText, newText })
    .catch(() => {
      backendDead = true;
      return null;
    });
}
