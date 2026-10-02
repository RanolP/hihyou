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
  ancestorLabels,
  atomKey,
  atomLeaves,
  buildFragments,
  type CodeFragment,
  elidedLines,
  type FileDiff,
  type LinePair,
  nodeHash,
  type SideInput,
  wholeDeclaration,
} from "./fragments.js";
import type {
  ChangedFileRef,
  EngineContext,
  Grammar,
  HighlightModule,
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
  /**
   * The unchanged lines an `elided` fragment of `path` hid, at its `lines`, `count` of them (absent: to the
   * end of the file), with the same display text and syntax scopes as the fragments `diff()` shows.
   * Undefined when `path` is not in this diffset, its content is unread, or the lines fall outside it.
   */
  expand(
    path: string,
    lines: LinePair,
    count?: number,
  ): Promise<(CodeFragment & { kind: "unchanged" }) | undefined>;
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
    expand: async (path, lines, count) => {
      const i = changes.findIndex((c) => c.path === path);
      const ref = changes[i];
      const file = (await self.diff())[i];
      if (!ref || !file || ref.kind) return undefined;
      const after = await afterVersion(ctx, ref, file.grammar !== undefined);
      return after && elidedLines(after.v, after.highlight, lines, count);
    },
  };
  return self;
}

/**
 * The after side's `Version` as `diffFiles` built it: `structured` says the file got a syntax diff
 * (`FileDiff.grammar` set), so it was parsed and maybe formatted; otherwise it is the plain blob text.
 */
async function afterVersion(
  ctx: EngineContext,
  ref: ChangedFileRef,
  structured: boolean,
): Promise<{ v: Version; highlight?: HighlightModule } | undefined> {
  const textB = decodeText(await readBlob(ctx, ref.after));
  if (textB === undefined) return undefined;
  const grammar = structured
    ? await ctx.host.grammars.forPath(ref.path)
    : undefined;
  if (!grammar) return { v: plainVersion(textB) };
  const textA = decodeText(await readBlob(ctx, ref.before));
  if (textA === undefined) return undefined;
  const [treeA, treeB] = await Promise.all([
    parseBlob(ctx, ref.before, grammar, textA),
    parseBlob(ctx, ref.after, grammar, textB),
  ]);
  const [, b] = await displayVersions(
    ctx,
    ref,
    grammar,
    [treeA, textA],
    [treeB, textB],
  );
  return { v: b, ...(grammar.highlight && { highlight: grammar.highlight }) };
}

/** Both sides formatted, or neither: a diff of formatted against unformatted text is all noise. */
async function displayVersions(
  ctx: EngineContext,
  ref: ChangedFileRef,
  grammar: Grammar,
  [treeA, textA]: [Tree, string],
  [treeB, textB]: [Tree, string],
): Promise<[Version & { tree: Tree }, Version & { tree: Tree }]> {
  const [fa, fb] = await Promise.all([
    formatBlob(ctx, ref.before, grammar, treeA),
    formatBlob(ctx, ref.after, grammar, treeB),
  ]);
  const version = (tree: Tree, text: string, f: typeof fa) =>
    (fa && fb && f
      ? formattedVersion(tree, f.text, f.anchors)
      : plainVersion(text, tree)) as Version & { tree: Tree };
  return [version(treeA, textA, fa), version(treeB, textB, fb)];
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
      ? {
          a: sideInput(p.a, "grammar" in p ? p.grammar.declarations : undefined),
          b: sideInput(p.b, "grammar" in p ? p.grammar.declarations : undefined),
          touched: false,
        }
      : undefined,
  );
  for (const c of cross.edits) {
    const from = prepared[c.from];
    const to = prepared[c.to];
    if (!from || !to || !("mapping" in from) || !("mapping" in to)) continue;    record(c, sides[c.from]?.a, sides[c.to]?.b, from.ref, to.ref);
    for (const s of [sides[c.from], sides[c.to]]) if (s) s.touched = true;
  }

  return prepared.map((p, i): FileDiff => {
    const path = p.ref.path;
    const s = sides[i];
    const status = statusOf(p.ref);
    if ("unread" in p || !s)
      return {
        path,
        fragments: [],
        collapsed: { reason: "unread" in p ? p.unread : "binary" },
        ...(status && { status }),
      };
    const text = p.ref.after === null ? p.texts[0] : p.texts[1];
    const head = { path, ...(status && { status }) };
    if (!("mapping" in p)) {
      // Without a tree the changed line is the unit the viewer paints; a whole file is the change, unpainted.
      for (const e of lineDiff(p.texts[0], p.texts[1], indentIsSyntax(path))) {
        if ("old" in e) {
          s.a.changed.push(e.old);
          if (!status) s.a.emphasis.push(e.old);
        }
        if ("new" in e) {
          s.b.changed.push(e.new);
          if (!status) s.b.emphasis.push(e.new);
        }
      }
      const reason = foldReason({
        path,
        text,
        ...(p.fallback && { fallback: p.fallback }),
      });
      return {
        ...head,
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
      record({ edit: e, from: i, to: i }, s.a, s.b, p.ref, p.ref, status !== undefined);
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
    return {
      ...head,
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
  const [a, b] = await displayVersions(
    ctx,
    ref,
    grammar,
    [treeA, textA],
    [treeB, textB],
  );
  return { ref, texts, a, b, grammar, mapping };
}

const sideInput = (v: Version, declarations?: ReadonlySet<string>): SideInput => ({
  ...(declarations && { declarations }),
  v,
  changed: [],
  emphasis: [],
  moves: [],
  nodes: [],
  wholes: [],
});

/**
 * Marks one edit on the side(s) it touches: an insert, delete or update changes and emphasizes its node, except
 * an inserted or deleted whole unit (a declaration, or any top node when `wholeFile`), which is outlined as one;
 * a move changes the lines at both ends and points each end at the other. A move emphasizes nothing itself:
 * what changed inside it arrives as its own inserts, deletes and updates, so only those stand out in the box.
 */
function record(
  { edit: e }: Pick<CrossEdit, "edit" | "from" | "to">,
  a: SideInput | undefined,
  b: SideInput | undefined,
  refA: ChangedFileRef,
  refB: ChangedFileRef,
  wholeFile = false,
): void {
  const range = (s: SideInput, n: number) => ({
    start: s.v.start(n),
    end: s.v.end(n),
  });
  // A whole file or a whole declaration is one atom and the change itself, so nothing in it is emphasized.
  // A whole file or a whole declaration is the change itself: outlined as one unit, nothing in it emphasized.
  const unit = (s: SideInput | undefined, n: number | undefined, side: "before" | "after"): boolean => {
    const tree = s?.v.tree;
    if (!s || !tree || n === undefined) return false;
    const whole = side === "after" ? "added" : "deleted";
    const one = (top: number): boolean => {
      const declaration = wholeDeclaration(s.v, tree, top, s.declarations);
      if (!wholeFile && !declaration) return false;
      s.changed.push(range(s, top));
      s.wholes.push({ node: top, whole, ...declaration });
      return true;
    };
    if (n !== tree.root) return one(n);
    // An inserted root is every top node inserted; each is a unit or not on its own.
    for (const top of namedChildren(tree, n)) if (!one(top)) mark(s, top);
    return true;
  };
  const mark = (s: SideInput | undefined, n: number | undefined) => {
    if (!s || n === undefined) return;
    const r = range(s, n);
    s.changed.push(r);
    s.emphasis.push(r);
  };
  const path = atomPath(refA, refB);
  // One atom per leaf of an inserted or deleted subtree, keyed by its own side alone.
  const leaves = (s: SideInput | undefined, n: number | undefined, side: "before" | "after") => {
    const tree = s?.v.tree;
    if (!s || !tree || n === undefined) return;
    for (const leaf of atomLeaves(tree, n))
      s.nodes.push({
        node: leaf,
        atom: atomKey({ path, ancestors: ancestorLabels(tree, leaf), [side]: nodeHash(tree, leaf) }),
      });
  };
  switch (e.kind) {
    case "insert":
      if (!unit(b, e.b, "after")) mark(b, e.b);
      leaves(b, e.b, "after");
      return;
    case "delete":
      if (!unit(a, e.a, "before")) mark(a, e.a);
      leaves(a, e.a, "before");
      return;
    case "update":
      mark(a, e.a);
      mark(b, e.b);
      pairAtom(e, a, b, path);
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
  const inFile = refA === refB;
  a.moves.push({
    node: e.a,
    counterpart: { path: refB.path, at: [stepsOf(tb, e.b)] },
    ...(inFile && { twin: e.b }),
  });
  b.moves.push({
    node: e.b,
    counterpart: { path: refA.oldPath ?? refA.path, at: [stepsOf(ta, e.a)] },
    ...(inFile && { twin: e.a }),
  });
  pairAtom(e, a, b, atomPath(refA, refB));
}

const statusOf = (ref: ChangedFileRef): FileDiff["status"] =>
  ref.before === null ? "added" : ref.after === null ? "deleted" : undefined;

function namedChildren(tree: Tree, n: number): number[] {
  const out: number[] = [];
  for (let i = 0, count = tree.count(n); i < count; i++)
    if (tree.named(tree.child(n, i))) out.push(tree.child(n, i));
  return out;
}

/** A file's own path, or for an edit between two files both of theirs, so either half names the pair alike. */
const atomPath = (refA: ChangedFileRef, refB: ChangedFileRef) =>
  refA === refB ? refA.path : `${refA.oldPath ?? refA.path}→${refB.path}`;

/** One atom for both halves of an update or a move, under the before side's ancestors. */
function pairAtom(
  e: RawEdit,
  a: SideInput | undefined,
  b: SideInput | undefined,
  path: string,
): void {
  const ta = a?.v.tree;
  const tb = b?.v.tree;
  if (!a || !b || !ta || !tb || !("a" in e) || !("b" in e)) return;
  if (e.a === undefined || e.b === undefined) return;
  const atom = atomKey({
    path,
    ancestors: ancestorLabels(ta, e.a),
    before: nodeHash(ta, e.a),
    after: nodeHash(tb, e.b),
  });
  a.nodes.push({ node: e.a, atom });
  b.nodes.push({ node: e.b, atom });
}

/** Formats whose indentation is syntax, so re-indenting a line changes it: Python, YAML and Makefiles. */
function indentIsSyntax(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return /\.(?:pyi?|ya?ml|mk)$|^(?:gnu)?makefile$/i.test(name);
}
