import {
  editScript,
  lineDiff,
  type Mapping,
  MatchBudgetExceeded,
  match,
  type RawEdit,
  Side,
} from "syntechs/diff";
import type { Tree } from "syntechs/core";
import { type Anchor, createAnchor, stepsOf } from "./anchor.js";
import { cacheKey } from "./cache.js";
import {
  decodeText,
  formatBlob,
  formattedVersion,
  parseBlob,
  plainVersion,
  readBlob,
  type Version,
} from "./file.js";
import { foldReason } from "./fold.js";
import {
  buildFragments,
  type FileDiff,
  mergeRanges,
  type SideInput,
} from "./fragments.js";
import type {
  ChangedFileRef,
  EngineContext,
  Grammar,
  Host,
  SerializedDiffsetId,
} from "./host.js";
import { createInterDiffset, type InterDiffset } from "./interdiff.js";
import { type CrossEdit, crossFileMoves } from "./move.js";
import type { AnchorData } from "./review.js";

/** Engine object; captures the engine. Not serialized. */
export interface Diffset<H extends Host> {
  /** Host-issued opaque key, format undecided. Same data -> same id. Unique within one host only. */
  id: string;
  changes: ChangedFileRef[];
  diff(): Promise<FileDiff[]>;
  interdiff(to: Diffset<H>): InterDiffset<H>;
  anchor(data: AnchorData): Anchor;
}

export async function openDiffset<H extends Host>(
  ctx: EngineContext,
  data: SerializedDiffsetId<H>,
): Promise<Diffset<H>> {
  const { id, changes } = await ctx.cache.through(
    cacheKey.resolve(data),
    () => ctx.host.resolveDiffset(data as never),
    (r) => JSON.stringify(r).length * 2,
  );
  const self: Diffset<H> = {
    id,
    changes,
    diff: () =>
      ctx.cache.through(
        cacheKey.diff(id),
        () => diffFiles(ctx, changes),
        fileDiffBytes,
      ),
    interdiff: (to) => createInterDiffset(ctx, self, to),
    anchor: (data) => createAnchor(ctx, changes, data),
  };
  return self;
}

export const fileDiffBytes = (files: FileDiff[]) =>
  JSON.stringify(files).length * 2;

/** Past either size a file gets a line diff before it is parsed or matched. */
const maxChars = 500_000;
const maxNodes = 50_000;
/** Share of a side's text inside ERROR nodes past which the tree is too broken to diff structurally. */
const maxErrorRatio = 0.1;

type Prepared =
  | { ref: ChangedFileRef; unread: "binary" | "submodule" }
  | {
      ref: ChangedFileRef;
      texts: [string, string];
      a: Version;
      b: Version;
      fallback?: "too-large" | "parse-error";
    }
  | {
      ref: ChangedFileRef;
      texts: [string, string];
      a: Version & { tree: Tree };
      b: Version & { tree: Tree };
      grammar: Grammar;
      mapping: Mapping;
    };

/**
 * Every file of one change set at once, so a declaration moved between files is found whichever file
 * a viewer opens first.
 */
export async function diffFiles(
  ctx: EngineContext,
  changes: readonly ChangedFileRef[],
): Promise<FileDiff[]> {
  const prepared = await Promise.all(changes.map((ref) => prepare(ctx, ref)));
  // JSON is data, not code: a key or a block of config repeated in another file did not move there.
  const cross = crossFileMoves(
    prepared.map((p) =>
      "mapping" in p && p.grammar.language.name !== "json"
        ? p.mapping
        : undefined,
    ),
  );
  const sides = prepared.map((p) =>
    "a" in p
      ? { a: sideInput(p.a), b: sideInput(p.b), touched: false }
      : undefined,
  );
  for (const c of cross.edits) {
    const from = prepared[c.from];
    const to = prepared[c.to];
    if (!from || !to || !("mapping" in from) || !("mapping" in to)) continue;
    record(c, sides[c.from]?.a, sides[c.to]?.b, from.ref, to.ref);
    for (const s of [sides[c.from], sides[c.to]]) if (s) s.touched = true;
  }

  return prepared.map((p, i): FileDiff => {
    const path = p.ref.path;
    const s = sides[i];
    if ("unread" in p || !s)
      return {
        path,
        fragments: [],
        collapsed: { reason: "unread" in p ? p.unread : "binary" },
      };
    const text = p.ref.after === null ? p.texts[0] : p.texts[1];
    if (!("mapping" in p)) {
      for (const e of lineDiff(p.texts[0], p.texts[1], indentIsSyntax(path))) {
        if ("old" in e) s.a.changed.push(e.old);
        if ("new" in e) s.b.changed.push(e.new);
      }
      const reason = foldReason({
        path,
        text,
        ...(p.fallback && { fallback: p.fallback }),
      });
      return {
        path,
        fragments: buildFragments({
          a: s.a,
          b: s.b,
          indentMatters: indentIsSyntax(path),
        }),
        ...(reason && { collapsed: { reason } }),
      };
    }
    const script = editScript(p.mapping, cross.claimed[i]);
    for (const e of script.edits)
      record({ edit: e, from: i, to: i }, s.a, s.b, p.ref, p.ref);
    const reason = foldReason({
      path,
      text,
      onlyMoves:
        !s.touched &&
        script.edits.length > 0 &&
        script.edits.every((e) => e.kind === "move"),
      noEdits:
        !s.touched && script.edits.length === 0 && p.texts[0] !== p.texts[1],
    });
    for (const side of [s.a, s.b]) side.emphasis = mergeRanges(side.emphasis);
    return {
      path,
      grammar: p.grammar.id,
      fragments: buildFragments({
        a: s.a,
        b: s.b,
        mapping: p.mapping,
        indentMatters: indentIsSyntax(path),
        ...(p.grammar.highlight && { highlight: p.grammar.highlight }),
      }),
      ...(reason && { collapsed: { reason } }),
    };
  });
}

async function prepare(
  ctx: EngineContext,
  ref: ChangedFileRef,
): Promise<Prepared> {
  if (ref.kind) return { ref, unread: ref.kind };
  const [bytesA, bytesB] = await Promise.all([
    readBlob(ctx, ref.before),
    readBlob(ctx, ref.after),
  ]);
  const textA = decodeText(bytesA);
  const textB = decodeText(bytesB);
  if (textA === undefined || textB === undefined)
    return { ref, unread: "binary" };
  const texts: [string, string] = [textA, textB];
  const line = (fallback?: "too-large" | "parse-error"): Prepared => ({
    ref,
    texts,
    a: plainVersion(textA),
    b: plainVersion(textB),
    ...(fallback && { fallback }),
  });

  const grammar = await ctx.host.grammars.forPath(ref.path);
  if (!grammar) return line();
  if (Math.max(textA.length, textB.length) > maxChars) return line("too-large");
  const [treeA, treeB] = await Promise.all([
    parseBlob(ctx, ref.before, grammar, textA),
    parseBlob(ctx, ref.after, grammar, textB),
  ]);
  if (Math.max(treeA.nodeCount, treeB.nodeCount) > maxNodes)
    return line("too-large");
  if (
    treeA.errorChars > maxErrorRatio * textA.length ||
    treeB.errorChars > maxErrorRatio * textB.length
  )
    return line("parse-error");
  let mapping: Mapping;
  try {
    mapping = match(Side.of(treeA), Side.of(treeB));
  } catch (error) {
    if (error instanceof MatchBudgetExceeded) return line("too-large");
    throw error;
  }
  // Both sides formatted, or neither: a diff of formatted against unformatted text is all noise.
  const [fa, fb] = await Promise.all([
    formatBlob(ctx, ref.before, grammar, treeA),
    formatBlob(ctx, ref.after, grammar, treeB),
  ]);
  const version = (tree: Tree, text: string, f: typeof fa) =>
    (fa && fb && f
      ? formattedVersion(tree, f.text, f.anchors)
      : plainVersion(text, tree)) as Version & { tree: Tree };
  return {
    ref,
    texts,
    a: version(treeA, textA, fa),
    b: version(treeB, textB, fb),
    grammar,
    mapping,
  };
}

const sideInput = (v: Version): SideInput => ({
  v,
  changed: [],
  emphasis: [],
  moves: [],
});

/**
 * Marks one edit on the side(s) it touches: an insert, delete or update changes and emphasizes its node;
 * a move changes the lines at both ends and points each end at the other.
 */
function record(
  { edit: e }: Pick<CrossEdit, "edit" | "from" | "to">,
  a: SideInput | undefined,
  b: SideInput | undefined,
  refA: ChangedFileRef,
  refB: ChangedFileRef,
): void {
  const range = (s: SideInput, n: number) => ({
    start: s.v.start(n),
    end: s.v.end(n),
  });
  const mark = (s: SideInput | undefined, n: number | undefined) => {
    if (!s || n === undefined) return;
    const r = range(s, n);
    s.changed.push(r);
    s.emphasis.push(r);
  };
  switch (e.kind) {
    case "insert":
      mark(b, e.b);
      return;
    case "delete":
      mark(a, e.a);
      return;
    case "update":
      mark(a, e.a);
      mark(b, e.b);
      return;
    case "move":
      movePair(e, a, b, refA, refB);
  }
}

function movePair(
  e: RawEdit & { kind: "move" },
  a: SideInput | undefined,
  b: SideInput | undefined,
  refA: ChangedFileRef,
  refB: ChangedFileRef,
): void {
  const ta = a?.v.tree;
  const tb = b?.v.tree;
  if (!a || !b || !ta || !tb || e.a === undefined || e.b === undefined) return;
  a.moves.push({
    node: e.a,
    counterpart: { path: refB.path, at: [stepsOf(tb, e.b)] },
  });
  b.moves.push({
    node: e.b,
    counterpart: { path: refA.oldPath ?? refA.path, at: [stepsOf(ta, e.a)] },
  });
}

/** Formats whose indentation is syntax, so re-indenting a line changes it: Python, YAML and Makefiles. */
function indentIsSyntax(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return /\.(?:pyi?|ya?ml|mk)$|^(?:gnu)?makefile$/i.test(name);
}
