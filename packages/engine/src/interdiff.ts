import { type Mapping, MatchBudgetExceeded, match, Side } from "syntechs/diff";
import { type AstSteps, nodeAt, sidePath, stepsOf } from "./anchor.js";
import { cacheKey } from "./cache.js";
import { decodeText, parseBlob, readBlob } from "./file.js";
import type {
  CodeFragment,
  FileDiff,
  Side as FragmentSide,
} from "./fragments.js";
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
  diff(): Promise<FileDiff[]>; // patch vs patch: only the hunks the author changed between iterations
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
        () => patchVsPatch(ctx, from, to),
        fileDiffBytes,
      ),
    port: (threads) => port(ctx, from, to, threads),
  };
}

/**
 * A1 against A2 per file, keeping only the diff fragments that touch a hunk the two iterations do not
 * share. Each iteration's own diff supplies its hunks; a hunk both carry with the same removed and added
 * text is the same authored change, only moved by the base under it, so it and any upstream edit beside
 * it drop out. A file whose patch did not change is left out.
 */
async function patchVsPatch<H extends Host>(
  ctx: EngineContext,
  from: Diffset<H>,
  to: Diffset<H>,
): Promise<FileDiff[]> {
  const refs = afterVsAfter(from.changes, to.changes);
  const [files, own1, own2] = await Promise.all([
    diffFiles(
      ctx,
      refs.map((r) => r.ref),
    ),
    from.diff(),
    to.diff(),
  ]);
  const byPath = (fs: FileDiff[]) => new Map(fs.map((f) => [f.path, f]));
  const [ownFrom, ownTo] = [byPath(own1), byPath(own2)];
  const out: FileDiff[] = [];
  files.forEach((file, i) => {
    const r = refs[i];
    const f1 = r?.inBoth && ownFrom.get(r.inBoth[0]);
    const f2 = r?.inBoth && ownTo.get(r.inBoth[1]);
    if (!f1 || !f2 || file.fragments.length === 0) {
      out.push(file);
      return;
    }
    const fragments = keepAuthored(file.fragments, f1.fragments, f2.fragments);
    if (fragments.some((f) => f.kind === "diff"))
      out.push({ ...file, fragments });
  });
  return out;
}

type Hunk = CodeFragment & { kind: "diff" };
interface LineRange {
  start: number;
  end: number;
}

const sideText = (s: FragmentSide) => s.spans.map((p) => p.text).join("");
const sideLines = (s: FragmentSide): LineRange => {
  const text = sideText(s);
  // A side's text ends in the newline of its last line, except at the end of an unterminated file.
  const count =
    text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  return { start: s.startLine, end: s.startLine + count };
};
/** An empty range is the point a side's missing lines take the place of, so it touches its neighbours. */
const touches = (p: LineRange, q: LineRange) =>
  p.start === p.end || q.start === q.end
    ? p.start <= q.end && q.start <= p.end
    : p.start < q.end && q.start < p.end;

/**
 * `fragments` (A1 vs A2) with every diff that touches no unshared hunk turned into `elided`, context that
 * no longer sits beside a kept diff elided too, and adjacent elisions merged. begin/end are left as they
 * are, so they stay balanced.
 */
function keepAuthored(
  fragments: CodeFragment[],
  hunks1: CodeFragment[],
  hunks2: CodeFragment[],
): CodeFragment[] {
  const key = (h: Hunk) => `${sideText(h.before)}\0${sideText(h.after)}`;
  const unshared2 = new Map<string, Hunk[]>();
  for (const h of hunks2)
    if (h.kind === "diff")
      unshared2.set(key(h), [...(unshared2.get(key(h)) ?? []), h]);
  const regions1: LineRange[] = [];
  for (const h of hunks1) {
    if (h.kind !== "diff") continue;
    const twins = unshared2.get(key(h));
    if (twins && twins.length > 0) twins.shift();
    else regions1.push(sideLines(h.after));
  }
  const regions2 = [...unshared2.values()]
    .flat()
    .map((h) => sideLines(h.after));

  const kept = fragments.map(
    (f) =>
      f.kind === "diff" &&
      (regions1.some((r) => touches(r, sideLines(f.before))) ||
        regions2.some((r) => touches(r, sideLines(f.after)))),
  );
  const elide = (f: CodeFragment): CodeFragment =>
    f.kind === "diff"
      ? {
          kind: "elided",
          lines: { before: f.before.startLine, after: f.after.startLine },
        }
      : f.kind === "unchanged"
        ? { kind: "elided", lines: f.lines }
        : f;
  /** Whether the diff nearest `i` in direction `step`, past begin/end and context, is kept. */
  const besideKept = (i: number, step: 1 | -1): boolean => {
    for (let k = i + step; k >= 0 && k < fragments.length; k += step) {
      const kind = fragments[k]?.kind;
      if (kind === "diff") return kept[k] === true;
      if (kind === "elided") return false;
    }
    return false;
  };
  const out: CodeFragment[] = [];
  fragments.forEach((f, i) => {
    const keep =
      f.kind === "diff"
        ? kept[i]
        : f.kind !== "unchanged" || besideKept(i, -1) || besideKept(i, 1);
    const g = keep ? f : elide(f);
    if (g.kind === "elided" && out.at(-1)?.kind === "elided") return;
    out.push(g);
  });
  return out;
}

/**
 * Per file either iteration touched, A1 against A2. A file only one iteration touched reads, in the
 * other, as that iteration's own before side: dropping a change shows A1 -> B1, a new one B2 -> A2.
 * `inBoth` names the file in each iteration's own diff when both list it.
 */
function afterVsAfter(
  from: readonly ChangedFileRef[],
  to: readonly ChangedFileRef[],
): { ref: ChangedFileRef; inBoth?: [string, string] }[] {
  const byPath = (refs: readonly ChangedFileRef[], side: "before" | "after") =>
    new Map(refs.map((r) => [sidePath(r, side), r]));
  const fromAfter = byPath(from, "after");
  const toAfter = byPath(to, "after");
  const fromBefore = byPath(from, "before");
  const toBefore = byPath(to, "before");
  const out: { ref: ChangedFileRef; inBoth?: [string, string] }[] = [];
  for (const path of new Set([...fromAfter.keys(), ...toAfter.keys()])) {
    const f = fromAfter.get(path);
    const t = toAfter.get(path);
    const before = f ? f.after : (toBefore.get(path)?.before ?? null);
    const after = t ? t.after : (fromBefore.get(path)?.before ?? null);
    if (before === after) continue;
    const kind = f?.kind ?? t?.kind;
    out.push({
      ref: { path, before, after, ...(kind && { kind }) },
      ...(f && t && { inBoth: [f.path, t.path] as [string, string] }),
    });
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
