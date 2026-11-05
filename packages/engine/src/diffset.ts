import { diffLines } from "diff";
import type { Tree } from "syntechs/core";
import {
  defaultMoveOptions,
  editScript,
  lineDiff,
  tokenDiff,
  type Mapping,
  MatchBudgetExceeded,
  match,
  type RawEdit,
  Side,
} from "syntechs/diff";
import {
  type Anchor,
  anchorOnLines,
  createAnchor,
  type LineRange,
  stepsOf,
} from "./anchor.js";
import { cacheKey } from "./cache.js";
import {
  decodeText,
  formatBlob,
  formattedVersion,
  lineEnd,
  lineOf,
  parseBlob,
  plainVersion,
  readBlob,
  sourceLines,
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
  type Rename,
  type SideInput,
  type Span,
  textHash,
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
import {
  type Claim,
  type ClaimContext,
  checkClaim,
  createClaimContext,
} from "./claim.js";
import { type Extract, findExtracts } from "./extract.js";
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
   * The anchor on the nodes covering `lines` of `path`'s `side`, counted in the blob as written: the inverse of
   * `Anchor.intoLineRanges`, so a line-based review thread finds its nodes. Rejects when the side has no tree.
   */
  anchorOnLines(
    side: "before" | "after",
    path: string,
    lines: LineRange,
  ): Promise<AnchorData>;
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
    anchorOnLines: (side, path, lines) =>
      anchorOnLines(ctx, changes, side, path, lines),
    expand: async (path, lines, count) => {
      const i = changes.findIndex((c) => c.path === path);
      const ref = changes[i];
      const file = (await self.diff())[i];
      if (!ref || !file || ref.kind) return undefined;
      const after = await afterVersion(
        ctx,
        ref,
        file.grammar !== undefined,
        file.fallback === "inflated" || file.fallback === "too-large",
      );
      return after && elidedLines(after.v, after.highlight, lines, count);
    },
  };
  return self;
}

/**
 * The after side's `Version` as `diffFiles` built it: `structured` says the file was parsed
 * (`FileDiff.grammar` set), so it may have been formatted; otherwise it is the plain blob text.
 */
async function afterVersion(
  ctx: EngineContext,
  ref: ChangedFileRef,
  structured: boolean,
  sourceText: boolean,
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
  return {
    v: sourceText ? plainVersion(textB, treeB) : b,
    ...(grammar.highlight && { highlight: grammar.highlight }),
  };
}

/** Both non-empty sides formatted, or neither: a diff of formatted against unformatted text is all noise. */
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
    (text.length === 0
      ? plainVersion(text, tree)
      : fa && fb && f
      ? formattedVersion(tree, f.text, f.anchors)
      : plainVersion(text, tree)) as Version & { tree: Tree };
  return [version(treeA, textA, fa), version(treeB, textB, fb)];
}

export const fileDiffBytes = (files: FileDiff[]) =>
  JSON.stringify(files).length * 2;

/** Original coloured text only where one formatted display line swallowed later source lines. */
function joinedSourceSpans(
  v: Version,
  original: string,
  lines: readonly number[],
  highlight: HighlightModule | undefined,
): Record<number, Span[]> {
  const out: Record<number, Span[]> = {};
  if (!v.tree) return out;
  const source = plainVersion(original, v.tree);
  for (let display = 0; display < lines.length; display++) {
    const first = lines[display] ?? 0;
    if (first === 0) continue;
    let next = source.lineStarts.length + 1;
    for (let i = display + 1; i < lines.length; i++) {
      const candidate = lines[i] ?? 0;
      if (candidate !== 0) {
        next = candidate;
        break;
      }
    }
    if (next <= first + 1) continue;
    const fragment = elidedLines(
      source,
      highlight,
      { before: first, after: first },
      next - first,
    );
    if (fragment) out[display + 1] = fragment.spans;
  }
  return out;
}

/** Past either matching size a file gets a line diff; a bounded parse still colours and scopes it. */
const maxChars = 500_000;
const maxNodes = 50_000;
const maxParseChars = 2_000_000;
/** Share of a side's text inside ERROR nodes past which the tree is too broken to diff structurally. */
const maxErrorRatio = 0.1;

type Prepared =
  | { ref: ChangedFileRef; unread: "binary" | "submodule" }
  | {
      ref: ChangedFileRef;
      texts: [string, string];
      a: Version;
      b: Version;
      grammar?: Grammar;
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
    undefined,
    undefined,
    prepared.map((p) => ("mapping" in p ? p.grammar.scope : undefined)),
  );
  const sides = prepared.map((p) =>
    "a" in p
      ? {
          a: sideInput(p.a, "grammar" in p ? p.grammar : undefined),
          b: sideInput(p.b, "grammar" in p ? p.grammar : undefined),
          touched: false,
        }
      : undefined,
  );
  // Every claim is checked against the trees before it is shown; one that fails reads as a delete plus an insert.
  let claims: ClaimContext | undefined;
  // The rename map each held edited move verified, by its move: `from:x:to:y`.
  const renamed = new Map<string, Rename[]>();
  const renamesOf = ({ edit: e, from, to }: Placed) =>
    e.kind === "move" ? renamed.get(`${from}:${e.a}:${to}:${e.b}`) : undefined;
  const holds = (claim: Claim) => {
    claims ??= createClaimContext(
      prepared.map((p) =>
        "mapping" in p
          ? {
              before: p.a.tree,
              after: p.b.tree,
              ...(p.grammar.declarations && {
                declarations: p.grammar.declarations,
              }),
              ...(p.grammar.scope && { scope: p.grammar.scope }),
            }
          : undefined,
      ),
    );
    const renames: Rename[] = [];
    if (checkClaim(claims, claim, renames) !== undefined) return false;
    if (claim.kind === "move" && renames.length > 0)
      renamed.set(`${claim.from}:${claim.x}:${claim.to}:${claim.y}`, renames);
    return true;
  };
  const trees = (file: number) => {
    const p = prepared[file];
    return p && "mapping" in p ? { a: p.a.tree, b: p.b.tree } : undefined;
  };
  for (const c of demote(cross.edits, trees, holds)) {
    const from = prepared[c.from];
    const to = prepared[c.to];
    if (!from || !to || !("mapping" in from) || !("mapping" in to)) continue;
    record(
      c,
      sides[c.from]?.a,
      sides[c.to]?.b,
      from.ref,
      to.ref,
      false,
      renamesOf(c),
    );
    for (const s of [sides[c.from], sides[c.to]]) if (s) s.touched = true;
  }
  const scripts = prepared.map((p, i) =>
    "mapping" in p
      ? demote(
          editScript(p.mapping, cross.claimed[i], {
            ...defaultMoveOptions,
            ...(p.grammar.scope && { scope: p.grammar.scope }),
          }).edits.map((edit) => ({
            edit,
            from: i,
            to: i,
          })),
          trees,
          holds,
        ).map((e) => e.edit)
      : undefined,
  );
  const extracts = findExtracts(
    prepared.map((p, i) => {
      const script = scripts[i];
      return script && "mapping" in p && p.grammar.language.name !== "json"
        ? {
            mapping: p.mapping,
            edits: script,
            ...(cross.claimed[i] && { claimed: cross.claimed[i].b }),
            b: p.b,
            ...(p.grammar.declarations && {
              declarations: p.grammar.declarations,
            }),
          }
        : undefined;
    }),
  ).filter((x) =>
    holds({
      kind: "extract",
      from: x.from,
      to: x.to,
      site: x.a,
      removed: x.removed,
      declaration: x.b,
      name: x.name,
    }),
  );
  // An extract's new declaration is its after half, no longer an insert of its own.
  const extracted = prepared.map(() => new Set<number>());
  for (const x of extracts) {
    const from = prepared[x.from];
    const to = prepared[x.to];
    if (!from || !to || !("mapping" in from) || !("mapping" in to)) continue;
    extracted[x.to]?.add(x.b);
    recordExtract(x, sides[x.from]?.a, sides[x.to]?.b, from.ref, to.ref);
    for (const s of [sides[x.from], sides[x.to]]) if (s) s.touched = true;
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
    let stats = p.ref.stats;
    if (!stats) {
      let added = 0;
      let removed = 0;
      for (const part of diffLines(p.texts[0], p.texts[1])) {
        if (part.added) added += part.count ?? 0;
        if (part.removed) removed += part.count ?? 0;
      }
      stats = { added, removed };
    }
    const head = { path, stats, ...(status && { status }) };
    if (!("mapping" in p)) {
      const reason = foldReason({
        path,
        text,
        ...(p.fallback && { fallback: p.fallback }),
        deleted: status === "deleted",
        changedLines: stats.added + stats.removed,
      });
      return {
        ...head,
        ...(p.grammar && { grammar: p.grammar.id }),
        ...(p.fallback && { fallback: p.fallback }),
        fragments: lineFragments(
          s.a,
          s.b,
          p.texts,
          path,
          !status && !reason && p.fallback !== "too-large",
          p.grammar?.highlight,
        ),
        ...(reason && { collapsed: { reason } }),
      };
    }
    const edits = scripts[i] ?? [];
    for (const e of pairCommentEdits(
      withoutNodes(edits, p.b.tree, extracted[i]),
      p.mapping,
    )) {
      const placed = { edit: e, from: i, to: i };
      record(
        placed,
        s.a,
        s.b,
        p.ref,
        p.ref,
        status !== undefined,
        renamesOf(placed),
      );
    }
    const changedLines = markedLineCount(s.a) + markedLineCount(s.b);
    const sourceChangedLines = stats.added + stats.removed;
    const inflated =
      sourceChangedLines > 0 &&
      changedLines > Math.max(100, sourceChangedLines * 10);
    const fragments = inflated
      ? lineFragments(
          sideInput(plainVersion(p.texts[0], p.a.tree), p.grammar),
          sideInput(plainVersion(p.texts[1], p.b.tree), p.grammar),
          p.texts,
          path,
          true,
          p.grammar.highlight,
        )
      : buildFragments({
          a: s.a,
          b: s.b,
          mapping: p.mapping,
          indentMatters: indentIsSyntax(path),
          ...(p.grammar.highlight && { highlight: p.grammar.highlight }),
        });
    const reason = foldReason({
      path,
      text,
      deleted: status === "deleted",
      changedLines: stats.added + stats.removed,
      onlyMoves:
        !s.touched && edits.length > 0 && edits.every((e) => e.kind === "move"),
      noEdits:
        !s.touched &&
        !fragments.some((f) => f.kind === "diff") &&
        p.texts[0] !== p.texts[1],
    });
    const mapped =
      !inflated && (p.a.text !== p.texts[0] || p.b.text !== p.texts[1])
        ? {
            before: sourceLines(p.a, p.texts[0]),
            after: sourceLines(p.b, p.texts[1]),
          }
        : undefined;
    return {
      ...head,
      grammar: p.grammar.id,
      ...(inflated && { fallback: "inflated" as const }),
      ...(mapped && {
        sourceLines: mapped,
        sourceSpans: {
          before: joinedSourceSpans(
            p.a,
            p.texts[0],
            mapped.before,
            p.grammar.highlight,
          ),
          after: joinedSourceSpans(
            p.b,
            p.texts[1],
            mapped.after,
            p.grammar.highlight,
          ),
        },
      }),
      fragments,
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
  const line = (
    fallback?: "too-large" | "parse-error",
    parsed?: { grammar: Grammar; trees: [Tree, Tree] },
  ): Prepared => ({
    ref,
    texts,
    a: plainVersion(textA, parsed?.trees[0]),
    b: plainVersion(textB, parsed?.trees[1]),
    ...(parsed && { grammar: parsed.grammar }),
    ...(fallback && { fallback }),
  });

  const grammar = await ctx.host.grammars.forPath(ref.path);
  if (!grammar) return line();
  const chars = Math.max(textA.length, textB.length);
  if (chars > maxParseChars) return line("too-large");
  const [treeA, treeB] = await Promise.all([
    parseBlob(ctx, ref.before, grammar, textA),
    parseBlob(ctx, ref.after, grammar, textB),
  ]);
  const parsed = { grammar, trees: [treeA, treeB] as [Tree, Tree] };
  if (chars > maxChars || Math.max(treeA.nodeCount, treeB.nodeCount) > maxNodes)
    return line("too-large", parsed);
  if (
    treeA.errorChars > maxErrorRatio * textA.length ||
    treeB.errorChars > maxErrorRatio * textB.length
  )
    return line("parse-error");
  let mapping: Mapping;
  try {
    mapping = match(Side.of(treeA), Side.of(treeB));
  } catch (error) {
    if (error instanceof MatchBudgetExceeded) return line("too-large", parsed);
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

const sideInput = (v: Version, grammar?: Grammar): SideInput => ({
  ...(grammar?.declarations && { declarations: grammar.declarations }),
  ...(grammar?.containers && { containers: grammar.containers }),
  v,
  changed: [],
  emphasis: [],
  moves: [],
  nodes: [],
  lineAtoms: [],
  wholes: [],
});

function lineFragments(
  a: SideInput,
  b: SideInput,
  texts: [string, string],
  path: string,
  emphasize: boolean,
  highlight?: HighlightModule,
): CodeFragment[] {
  // Without a tree the changed line is the unit the viewer paints; a whole file is the change, unpainted.
  for (const e of lineDiff(texts[0], texts[1], indentIsSyntax(path))) {
    if ("old" in e) {
      a.changed.push(e.old);
      recordLines(a, e.old, path, "before");
    }
    if ("new" in e) {
      b.changed.push(e.new);
      recordLines(b, e.new, path, "after");
    }
  }
  // A folded or too-large file skips the token diff, whose cost grows with the whole text.
  if (emphasize)
    for (const e of tokenDiff(texts[0], texts[1])) {
      if ("old" in e) a.emphasis.push(e.old);
      if ("new" in e) b.emphasis.push(e.new);
    }
  return buildFragments({
    a,
    b,
    indentMatters: indentIsSyntax(path),
    ...(highlight && { highlight }),
  });
}

function markedLineCount(s: SideInput): number {
  const marked = new Uint8Array(s.v.lineStarts.length);
  const mark = ({ start, end }: { start: number; end: number }) => {
    if (end <= start) return;
    marked.fill(1, lineOf(s.v, start), lineOf(s.v, end - 1) + 1);
  };
  for (const range of s.changed) mark(range);
  for (const move of s.moves)
    mark({ start: s.v.start(move.node), end: s.v.end(move.node) });
  return marked.reduce((count, value) => count + value, 0);
}

function recordLines(
  s: SideInput,
  range: { start: number; end: number },
  path: string,
  side: "before" | "after",
): void {
  const first = lineOf(s.v, range.start);
  const last = lineOf(s.v, Math.max(range.start, range.end - 1));
  for (let line = first; line <= last; line++) {
    const start = s.v.lineStarts[line] as number;
    const hash = textHash(s.v.text.slice(start, lineEnd(s.v, line)));
    s.lineAtoms.push({
      line,
      hash,
      atom: atomKey({ path, ancestors: [], [side]: hash }),
    });
  }
}

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
  renames?: readonly Rename[],
): void {
  const range = (s: SideInput, n: number) => ({
    start: s.v.start(n),
    end: s.v.end(n),
  });
  // A whole file or a whole declaration is one atom and the change itself, so nothing in it is emphasized.
  // A whole file or a whole declaration is the change itself: outlined as one unit, nothing in it emphasized.
  const unit = (
    s: SideInput | undefined,
    n: number | undefined,
    side: "before" | "after",
  ): boolean => {
    const tree = s?.v.tree;
    if (!s || !tree || n === undefined) return false;
    const whole = side === "after" ? "added" : "deleted";
    const one = (top: number): boolean => {
      const declaration = wholeDeclaration(
        s.v,
        tree,
        top,
        s.declarations,
        s.containers,
      );
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
  const markCommentUpdate = (
    before: SideInput | undefined,
    after: SideInput | undefined,
    oldNode: number | undefined,
    newNode: number | undefined,
  ): boolean => {
    const oldTree = before?.v.tree;
    const newTree = after?.v.tree;
    if (
      !before ||
      !after ||
      !oldTree ||
      !newTree ||
      oldNode === undefined ||
      newNode === undefined ||
      oldTree.count(oldNode) !== 0 ||
      newTree.count(newNode) !== 0 ||
      !oldTree.kindName(oldNode).includes("comment") ||
      !newTree.kindName(newNode).includes("comment")
    )
      return false;
    const oldRange = range(before, oldNode);
    const newRange = range(after, newNode);
    const oldText = before.v.text.slice(oldRange.start, oldRange.end);
    const newText = after.v.text.slice(newRange.start, newRange.end);
    if (oldText.includes("\n") || newText.includes("\n")) return false;
    before.changed.push(oldRange);
    after.changed.push(newRange);
    for (const edit of tokenDiff(oldText, newText)) {
      if ("old" in edit)
        before.emphasis.push({
          start: oldRange.start + edit.old.start,
          end: oldRange.start + edit.old.end,
        });
      if ("new" in edit)
        after.emphasis.push({
          start: newRange.start + edit.new.start,
          end: newRange.start + edit.new.end,
        });
    }
    return true;
  };
  const markMultilineUpdate = (
    before: SideInput | undefined,
    after: SideInput | undefined,
    oldNode: number | undefined,
    newNode: number | undefined,
  ): boolean => {
    if (!before || !after || oldNode === undefined || newNode === undefined)
      return false;
    const oldRange = range(before, oldNode);
    const newRange = range(after, newNode);
    const oldText = before.v.text.slice(oldRange.start, oldRange.end);
    const newText = after.v.text.slice(newRange.start, newRange.end);
    if (!oldText.includes("\n") && !newText.includes("\n")) return false;
    const lineEdits = lineDiff(oldText, newText, indentIsSyntax(refA.path));
    // A change in blank lines or spacing alone leaves no line edit: the whole leaf stays marked.
    if (lineEdits.length === 0) return false;
    for (const [i, edit] of lineEdits.entries()) {
      if ("old" in edit)
        before.changed.push({
          start: oldRange.start + edit.old.start,
          end: oldRange.start + edit.old.end,
        });
      if ("new" in edit)
        after.changed.push({
          start: newRange.start + edit.new.start,
          end: newRange.start + edit.new.end,
        });
      const next = lineEdits[i + 1];
      if (!("old" in edit) || !next || !("new" in next)) continue;
      // Per-hunk emphasis avoids noise across unrelated lines.
      for (const tokenEdit of tokenDiff(
        oldText.slice(edit.old.start, edit.old.end),
        newText.slice(next.new.start, next.new.end),
      )) {
        if ("old" in tokenEdit)
          for (const r of markerFree(
            oldText,
            edit.old.start + tokenEdit.old.start,
            edit.old.start + tokenEdit.old.end,
          ))
            before.emphasis.push({
              start: oldRange.start + r.start,
              end: oldRange.start + r.end,
            });
        if ("new" in tokenEdit)
          for (const r of markerFree(
            newText,
            next.new.start + tokenEdit.new.start,
            next.new.start + tokenEdit.new.end,
          ))
            after.emphasis.push({
              start: newRange.start + r.start,
              end: newRange.start + r.end,
            });
      }
    }
    return true;
  };
  const path = atomPath(refA, refB);
  // One atom per leaf of an inserted or deleted subtree, keyed by its own side alone.
  const leaves = (
    s: SideInput | undefined,
    n: number | undefined,
    side: "before" | "after",
  ) => {
    const tree = s?.v.tree;
    if (!s || !tree || n === undefined) return;
    for (const leaf of atomLeaves(tree, n))
      s.nodes.push({
        node: leaf,
        atom: atomKey({
          path,
          ancestors: ancestorLabels(tree, leaf),
          [side]: nodeHash(tree, leaf),
        }),
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
      if (
        !markCommentUpdate(a, b, e.a, e.b) &&
        !markMultilineUpdate(a, b, e.a, e.b)
      ) {
        mark(a, e.a);
        mark(b, e.b);
      }
      pairAtom(e, a, b, path);
      return;
    case "move":
      movePair(e, a, b, refA, refB, undefined, renames);
  }
}

/**
 * `start..end` of `text` without each line's leading comment marker (`*`, `//`, `#`): a rewrapped comment
 * moves its words across lines, and the markers it keeps are not the change.
 */
function markerFree(
  text: string,
  start: number,
  end: number,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const marker = /^[ \t]*(?:\*(?!\/)|\/\/+|#)[ \t]*/gm;
  marker.lastIndex = text.lastIndexOf("\n", start - 1) + 1;
  let from = start;
  for (let m = marker.exec(text); m && m.index < end; m = marker.exec(text)) {
    const markerEnd = m.index + m[0].length;
    if (m.index > from) out.push({ start: from, end: m.index });
    from = Math.max(from, markerEnd);
  }
  if (from < end) out.push({ start: from, end });
  return out;
}

function movePair(
  e: { a?: number; b?: number },
  a: SideInput | undefined,
  b: SideInput | undefined,
  refA: ChangedFileRef,
  refB: ChangedFileRef,
  extract?: string,
  renames?: readonly Rename[],
): void {
  const ta = a?.v.tree;
  const tb = b?.v.tree;
  if (!a || !b || !ta || !tb || e.a === undefined || e.b === undefined) return;
  const inFile = refA === refB;
  a.moves.push({
    node: e.a,
    counterpart: { path: refB.path, at: [stepsOf(tb, e.b)] },
    ...(inFile && { twin: e.b }),
    ...(extract !== undefined && { extract }),
    ...(renames && { renames }),
  });
  b.moves.push({
    node: e.b,
    counterpart: { path: refA.oldPath ?? refA.path, at: [stepsOf(ta, e.a)] },
    ...(inFile && { twin: e.a }),
    ...(extract !== undefined && { extract }),
    ...(renames && { renames }),
  });
  pairAtom(e, a, b, atomPath(refA, refB));
}

/**
 * An extract reads as a move from the code it replaced to the new declaration. The removed code keeps its
 * emphasis as deleted; in the declaration only what generalized that code stands out.
 */
function recordExtract(
  x: Extract,
  a: SideInput | undefined,
  b: SideInput | undefined,
  refA: ChangedFileRef,
  refB: ChangedFileRef,
): void {
  movePair(x, a, b, refA, refB, x.name);
  if (!b) return;
  for (const n of x.emphasis) {
    const r = { start: b.v.start(n), end: b.v.end(n) };
    b.changed.push(r);
    b.emphasis.push(r);
  }
}

type Placed = Pick<CrossEdit, "edit" | "from" | "to">;

/**
 * `edits` with every move `holds` rejects turned into a delete of its before node and an insert of its after node,
 * and the edits inside either half dropped with it: the halves are now whole new and whole gone code. An edit with
 * one end inside a rejected half keeps its other end, as a delete or an insert.
 */
function demote(
  edits: readonly Placed[],
  trees: (file: number) => { a: Tree; b: Tree } | undefined,
  holds: (claim: Claim) => boolean,
): Placed[] {
  const failed = edits.filter(
    (e) =>
      e.edit.kind === "move" &&
      e.edit.a !== undefined &&
      e.edit.b !== undefined &&
      !holds({
        kind: "move",
        from: e.from,
        to: e.to,
        x: e.edit.a,
        y: e.edit.b,
        edited: e.edit.edited === true,
      }),
  );
  if (failed.length === 0) return [...edits];
  const covered = (
    side: "a" | "b",
    file: number,
    n: number | undefined,
    self?: Placed,
  ) => {
    const tree = trees(file)?.[side];
    if (n === undefined || !tree) return false;
    return failed.some((f) => {
      const m = f.edit.kind === "move" ? f.edit[side] : undefined;
      return (
        f !== self &&
        (side === "a" ? f.from : f.to) === file &&
        m !== undefined &&
        tree.start(m) <= tree.start(n) &&
        tree.end(n) <= tree.end(m)
      );
    });
  };
  const out: Placed[] = [];
  const gone = (e: Placed, from: number) => {
    if (e.edit.kind === "insert" || e.edit.a === undefined) return;
    out.push({
      from,
      to: from,
      edit: {
        kind: "delete",
        old: e.edit.old,
        node: e.edit.node ?? "",
        a: e.edit.a,
      },
    });
  };
  const added = (e: Placed, to: number) => {
    if (e.edit.kind === "delete" || e.edit.b === undefined) return;
    const tree = trees(to)?.b;
    const node = tree ? tree.kindName(e.edit.b) : "";
    out.push({
      from: to,
      to,
      edit: { kind: "insert", new: e.edit.new, node, b: e.edit.b },
    });
  };
  for (const e of edits) {
    const a = e.edit.kind === "insert" ? undefined : e.edit.a;
    const b = e.edit.kind === "delete" ? undefined : e.edit.b;
    if (failed.includes(e)) {
      if (!covered("a", e.from, a, e)) gone(e, e.from);
      if (!covered("b", e.to, b, e)) added(e, e.to);
      continue;
    }
    const aIn = covered("a", e.from, a);
    const bIn = covered("b", e.to, b);
    if (!aIn && !bIn) out.push(e);
    else if (!aIn && a !== undefined) gone(e, e.from);
    else if (!bIn && b !== undefined) added(e, e.to);
  }
  return out;
}

/**
 * `edits` without the inserts inside `nodes`, and with `nodes` cut out of the inserts holding them, the rest of
 * each such insert kept piece by piece.
 */
function withoutNodes(
  edits: RawEdit[],
  tree: Tree,
  nodes: ReadonlySet<number> | undefined,
): RawEdit[] {
  if (!nodes || nodes.size === 0) return edits;
  const within = (n: number, m: number) =>
    tree.start(m) <= tree.start(n) && tree.end(n) <= tree.end(m);
  const split = (n: number): RawEdit[] => {
    if (tree.end(n) === tree.start(n) || [...nodes].some((m) => within(n, m)))
      return [];
    if (![...nodes].some((m) => within(m, n)))
      return [
        {
          kind: "insert",
          new: { start: tree.start(n), end: tree.end(n) },
          node: tree.kindName(n),
          b: n,
        },
      ];
    const out: RawEdit[] = [];
    for (let i = 0, count = tree.count(n); i < count; i++)
      out.push(...split(tree.child(n, i)));
    return out;
  };
  return edits.flatMap((e) =>
    e.kind === "insert" && e.b !== undefined ? split(e.b) : [e],
  );
}

function pairCommentEdits(edits: RawEdit[], mapping: Mapping): RawEdit[] {
  const { a, b, src } = mapping;
  const ta = a.tree;
  const tb = b.tree;
  const childIndex = (tree: Tree, parent: number, child: number) => {
    for (let i = 0, count = tree.count(parent); i < count; i++)
      if (tree.child(parent, i) === child) return i;
    return -1;
  };
  const comment = (tree: Tree, n: number | undefined) =>
    n !== undefined &&
    tree.count(n) === 0 &&
    tree.kindName(n).includes("comment") &&
    !tree.text(n).includes("\n");
  const inserts = edits.filter(
    (e): e is RawEdit & { kind: "insert"; b: number } =>
      e.kind === "insert" && comment(tb, e.b),
  );
  const paired = new Set<RawEdit>();
  return edits.flatMap((e): RawEdit[] => {
    if (paired.has(e)) return [];
    if (e.kind !== "delete" || !comment(ta, e.a) || e.a === undefined)
      return [e];
    const oldParent = ta.parent(e.a);
    const oldIndex = childIndex(ta, oldParent, e.a);
    const insert = inserts.find((candidate) => {
      if (paired.has(candidate)) return false;
      const newParent = tb.parent(candidate.b);
      return (
        src[a.index(oldParent)] === b.index(newParent) &&
        oldIndex === childIndex(tb, newParent, candidate.b)
      );
    });
    if (!insert) return [e];
    paired.add(insert);
    return [
      {
        kind: "update",
        old: e.old,
        new: insert.new,
        ...(e.node !== undefined && { node: e.node }),
        a: e.a,
        b: insert.b,
      },
    ];
  });
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
  e: RawEdit | { a?: number; b?: number },
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
