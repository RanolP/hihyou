/**
 * Injection points for everything the viewer can't do by itself: AST
 * analysis, seen-state persistence, and GitHub I/O. The extension backs
 * them with RPC/chrome.storage/fetch; the website demo with fixtures.
 */

import type {
  DeclHashInfo,
  FileAnalysis,
  SemanticHunk,
} from '@hihyou/diff-engine/ast-service';
import type { SeenState } from '@hihyou/diff-engine/seen-hunks';
import type {
  ChangesPayload,
  DiffContent,
} from '@hihyou/github/github-changes';
import type { PrLocation } from '@hihyou/github/pr-location';
import type { StackEntry } from '@hihyou/github/pr-stack';

export interface TsHoverRequest {
  cacheKey: string;
  repoFilePath: string;
  fileName: string;
  fileText: string;
  line: number;
  col: number;
  /** undefined = not sent; null = repo has no lockfile. */
  lockfileText?: string | null;
}

export interface AstClient {
  analyzeFile(path: string, text: string): Promise<FileAnalysis | null>;
  analyzeBlob(
    owner: string,
    repo: string,
    oid: string,
    path: string,
  ): Promise<FileAnalysis | null>;
  declHashesBlob(
    owner: string,
    repo: string,
    oid: string,
    path: string,
  ): Promise<DeclHashInfo[] | null>;
  structuralDiff(
    path: string,
    oldText: string,
    newText: string,
  ): Promise<SemanticHunk[] | null>;
  /** Quick info; 'NEED_PROJECT' asks the caller to resend the lockfile. */
  tsHover(req: TsHoverRequest): Promise<string | null>;
}

export interface SeenStore {
  load(pr: PrLocation): Promise<SeenState>;
  save(pr: PrLocation, state: SeenState): Promise<void>;
}

export interface ViewerPorts {
  ast: AstClient;
  seenStore: SeenStore;
  /** Sync GitHub's per-file Viewed flag (review action). */
  setFileViewed(
    pr: PrLocation,
    path: string,
    viewed: boolean,
  ): Promise<boolean>;
  fetchRawBlob(
    owner: string,
    repo: string,
    oid: string,
    path: string,
  ): Promise<string | null>;
  /** Late-loaded per-path diff contents of large PRs. */
  fetchDiffEntries(
    pr: PrLocation,
    rangeParam: string,
    paths: string[],
  ): Promise<DiffContent[]>;
  resolveStack(pr: PrLocation, payload: ChangesPayload): Promise<StackEntry[]>;
}

export interface AstSeeds {
  /** FileAnalysis by path. */
  analyses?: Record<string, FileAnalysis>;
  /** DeclHashInfo[] by `${oid}:${path}`. */
  declHashes?: Record<string, DeclHashInfo[]>;
}

/** Fixture-backed AstClient: answers from seeds, null for everything else. */
export function seededAstClient(seeds: AstSeeds = {}): AstClient {
  return {
    analyzeFile: async () => null,
    analyzeBlob: async (_owner, _repo, _oid, path) =>
      seeds.analyses?.[path] ?? null,
    declHashesBlob: async (_owner, _repo, oid, path) =>
      seeds.declHashes?.[`${oid}:${path}`] ?? null,
    structuralDiff: async () => null,
    tsHover: async () => null,
  };
}

/** In-memory SeenStore (website demo; nothing persists). */
export function memorySeenStore(): SeenStore {
  const states = new Map<string, SeenState>();
  const key = (pr: PrLocation) => `${pr.owner}/${pr.repo}#${pr.number}`;
  return {
    load: async (pr) => states.get(key(pr)) ?? {},
    save: async (pr, state) => {
      states.set(key(pr), state);
    },
  };
}
