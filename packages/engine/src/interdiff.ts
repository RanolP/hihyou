import { type Mapping, MatchBudgetExceeded, match, Side } from "syntechs/diff";
import { type AstSteps, nodeAt, sidePath, stepsOf } from "./anchor.js";
import { cacheKey } from "./cache.js";
import { decodeText, parseBlob, readBlob } from "./file.js";
import type { FileDiff } from "./fragments.js";
import type {
  BlobId,
  ChangedFileRef,
  EngineContext,
  Grammar,
  Host,
} from "./host.js";
import type { Diffset } from "./diffset.js";
import { diffFiles, fileDiffBytes } from "./diffset.js";
import type { ReviewThread, ReviewThreads } from "./review.js";

/** Two iterations of one change. Matches before-vs-before AND after-vs-after; equal BlobIds skip matching. */
export interface InterDiffset<H extends Host> {
  from: Diffset<H>;
  to: Diffset<H>;
  diff(): Promise<FileDiff[]>; // after vs after
  port(threads: ReviewThreads<H>): Promise<PortResult<H>>; // via syntechs diff matcher
}

export interface PortResult<H extends Host> {
  ported: ReviewThreads<H>;
  lost: ReviewThread<H>[]; // no match found; shown to the user, never dropped
}

export function createInterDiffset<H extends Host>(
  ctx: EngineContext,
  from: Diffset<H>,
  to: Diffset<H>,
): InterDiffset<H> {
  return {
    from,
    to,
    diff: () =>
      ctx.cache.through(
        cacheKey.interdiff(from.id, to.id),
        () => diffFiles(ctx, afterVsAfter(from.changes, to.changes)),
        fileDiffBytes,
      ),
    port: (threads) => port(ctx, from, to, threads),
  };
}

/**
 * The after side of every file either iteration touched. A file only one iteration touched is taken to
 * read, in the other, as that iteration's before side of it: the base both iterations share.
 */
function afterVsAfter(
  from: readonly ChangedFileRef[],
  to: readonly ChangedFileRef[],
): ChangedFileRef[] {
  const byPath = (refs: readonly ChangedFileRef[], side: "before" | "after") =>
    new Map(refs.map((r) => [sidePath(r, side), r]));
  const fromAfter = byPath(from, "after");
  const toAfter = byPath(to, "after");
  const fromBefore = byPath(from, "before");
  const toBefore = byPath(to, "before");
  const out: ChangedFileRef[] = [];
  for (const path of new Set([...fromAfter.keys(), ...toAfter.keys()])) {
    const f = fromAfter.get(path);
    const t = toAfter.get(path);
    const before = f ? f.after : (toBefore.get(path)?.before ?? null);
    const after = t ? t.after : (fromBefore.get(path)?.before ?? null);
    if (before === after) continue;
    const kind = f?.kind ?? t?.kind;
    out.push({ path, before, after, ...(kind && { kind }) });
  }
  return out;
}

async function port<H extends Host>(
  ctx: EngineContext,
  from: Diffset<H>,
  to: Diffset<H>,
  threads: ReviewThreads<H>,
): Promise<PortResult<H>> {
  if (threads.diffsetId !== from.id)
    throw new RangeError(
      `threads belong to diffset ${threads.diffsetId}, not ${from.id}`,
    );
  const grammars = { ...threads.grammars };
  const mappings = new Map<string, Promise<Mapping | undefined>>();
  const ported: ReviewThread<H>[] = [];
  const lost: ReviewThread<H>[] = [];

  for (const thread of threads.threads) {
    const { side, path } = thread.anchor;
    const oldBlob = blobIn(from.changes, to.changes, side, path);
    const newBlob = blobIn(to.changes, from.changes, side, path);
    if (!oldBlob || !newBlob) {
      lost.push(thread);
      continue;
    }
    if (oldBlob === newBlob) {
      ported.push(thread);
      continue;
    }
    const grammar = await ctx.host.grammars.forPath(path);
    if (!grammar) {
      lost.push(thread);
      continue;
    }
    grammars[grammar.language.name] = grammar.id;
    const key = `${oldBlob}\0${newBlob}`;
    let pending = mappings.get(key);
    if (!pending) {
      pending = matchBlobs(ctx, grammar, oldBlob, newBlob);
      mappings.set(key, pending);
    }
    const mapping = await pending;
    const nodes = mapping && mapNodes(mapping, thread.anchor.nodes);
    if (nodes) ported.push({ ...thread, anchor: { ...thread.anchor, nodes } });
    else lost.push(thread);
  }

  // `ran` vouches for one Diffset's code; the new iteration has not been run yet.
  return {
    ported: { diffsetId: to.id, grammars, ran: [], threads: ported },
    lost,
  };
}

/**
 * The blob at `path` on `side` of one iteration. A file the iteration does not list is unchanged there,
 * so both its sides read as the base, which only `other`'s before side can name. That borrow is sound
 * only while both iterations share a base: the engine has no base id, so a file both list with different
 * before blobs is the one proof the base moved, and then an unlisted file's blob is unknown.
 */
function blobIn(
  changes: readonly ChangedFileRef[],
  other: readonly ChangedFileRef[],
  side: "before" | "after",
  path: string,
): BlobId | null | undefined {
  const listed = changes.find((c) => sidePath(c, side) === path);
  if (listed) return listed[side];
  if (changes.some((c) => c.path === path || c.oldPath === path))
    return undefined;
  const otherBefore = new Map(other.map((r) => [sidePath(r, "before"), r]));
  const baseMoved = changes.some((c) => {
    const o = otherBefore.get(sidePath(c, "before"));
    return o !== undefined && o.before !== c.before;
  });
  return baseMoved ? undefined : otherBefore.get(path)?.before;
}

async function matchBlobs(
  ctx: EngineContext,
  grammar: Grammar,
  a: BlobId,
  b: BlobId,
): Promise<Mapping | undefined> {
  const [textA, textB] = await Promise.all(
    [a, b].map(async (id) => decodeText(await readBlob(ctx, id))),
  );
  if (textA === undefined || textB === undefined) return undefined;
  const [treeA, treeB] = await Promise.all([
    parseBlob(ctx, a, grammar, textA),
    parseBlob(ctx, b, grammar, textB),
  ]);
  try {
    return match(Side.of(treeA), Side.of(treeB));
  } catch (error) {
    if (error instanceof MatchBudgetExceeded) return undefined;
    throw error;
  }
}

/** Every node's counterpart in the new tree, or undefined when any node has none. */
function mapNodes(
  mapping: Mapping,
  nodes: readonly AstSteps[],
): AstSteps[] | undefined {
  const out: AstSteps[] = [];
  for (const steps of nodes) {
    const n = nodeAt(mapping.a.tree, steps);
    if (n === undefined) return undefined;
    const j = mapping.src[mapping.a.index(n)];
    if (j === undefined || j < 0) return undefined;
    out.push(stepsOf(mapping.b.tree, mapping.b.node(j)));
  }
  return out;
}
