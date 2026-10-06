import type { Tree } from "../core/arena.js";
import { Side } from "./side.js";

/**
 * A grammar's lexical scoping, as data: which positions bind a name, which node is each binder's scope, and which
 * constructs make scope uncertain. It covers lexically scoped features only; anything it does not name is either
 * a reference resolved by name or, where it could bind, a reason to keep the names around it. See
 * `docs/design/move-theory.md`, "Normalization".
 */
export interface ScopeRules {
  /** Leaf kinds that name a variable: a reference, resolved to the nearest enclosing binder of its name. */
  references: readonly string[];
  /** Named leaf kinds that never denote a variable even when they spell one's name (property and type names). */
  inert: readonly string[];
  /** Kinds a `"block"`-scoped binder belongs to the nearest of. */
  blocks: readonly string[];
  /** Kinds whose binders are top-level declarations, exposed, so never normalized. */
  module: readonly string[];
  /** Kinds bounding the region an uncertain construct affects (a function, the module). */
  functions: readonly string[];
  /** Kinds between a `"block"`-scoped binder and its block that make it exposed (an `export`), so kept. */
  exports: readonly string[];
  binders: readonly BinderRule[];
  /** Destructuring: a pattern kind and the fields holding its sub-patterns, `null` for each unfielded named child. */
  patterns: Readonly<Record<string, readonly (string | null)[]>>;
  /** Binding leaf kinds that also spell a key (`{ a }` in a pattern), so the name is kept. */
  keyed: readonly string[];
  /** Reference-kind leaves at these positions are not references (a JSX tag name); a binder they spell is kept. */
  nonReferences: readonly { holder: string; field: string }[];
  /** Constructs under which scope is not certain (`var`, `with`, `eval`): every binder they can reach is kept. */
  uncertain: readonly UncertainRule[];
}

export interface BinderRule {
  /** The kind of the node holding the binding name or pattern. */
  holder: string;
  /** The holder's field holding it; absent, each of its named children. */
  field?: string;
  /** The kind the holder's parent must have. */
  parent?: string;
  /** Labels the holder's `kind` field must carry (`const` in `for (const x of xs)`). */
  kind?: readonly string[];
  /** The binder's scope: the holder's ancestor this many levels up, or its nearest `blocks` ancestor. */
  scope: number | "block";
  /** A name that still shadows but is never normalized: a declaration's own name. */
  opaque?: boolean;
  /** Child kinds of the holder that make it opaque (a TS parameter property declares a field too). */
  opaqueWith?: readonly string[];
}

export interface UncertainRule {
  kind: string;
  /** With `label`: the child in this field must carry it (`eval` as the callee). */
  field?: string;
  label?: string;
  /** Only when nested in a block that is not a function's body (a function declaration in an `if`). */
  nested?: boolean;
}

/** The binder each occurrence of a scope-certain local name resolves to, and each such binder's scope node. */
export interface Locals {
  /** Occurrence (binding or reference) to binder number. */
  of: Map<number, number>;
  /** Scope node by binder number. */
  scope: number[];
  /** Binding occurrence by binder number. */
  binding: number[];
}

interface Binder {
  name: string;
  leaf: number;
  scope: number;
  kept: boolean;
}

/** Resolves every scope-certain local binder of `tree` under `rules` and the occurrences that refer to it. */
export function resolveLocals(tree: Tree, rules: ScopeRules): Locals {
  const side = Side.of(tree);
  const set = (xs: readonly string[]) => new Set(xs);
  const references = set(rules.references);
  const inert = set(rules.inert);
  const blocks = set(rules.blocks);
  const module = set(rules.module);
  const functions = set(rules.functions);
  const exports = set(rules.exports);
  const keyed = set(rules.keyed);
  const byHolder = new Map<string, BinderRule[]>();
  for (const r of rules.binders)
    byHolder.set(r.holder, [...(byHolder.get(r.holder) ?? []), r]);
  const nonRef = new Map<string, Set<string>>();
  for (const p of rules.nonReferences)
    nonRef.set(p.holder, new Set([...(nonRef.get(p.holder) ?? []), p.field]));
  const uncertainByKind = new Map<string, UncertainRule[]>();
  for (const u of rules.uncertain)
    uncertainByKind.set(u.kind, [...(uncertainByKind.get(u.kind) ?? []), u]);

  const binders: Binder[] = [];
  const binderAt = new Map<number, number>();
  /** Nodes whose constructs make scope uncertain. */
  const doubts: number[] = [];

  const fieldChild = (n: number, field: string) => {
    for (let i = 0, c = tree.count(n); i < c; i++)
      if (tree.fieldName(tree.child(n, i)) === field) return tree.child(n, i);
    return undefined;
  };
  const named = (n: number, unfielded: boolean) => {
    const out: number[] = [];
    for (let i = 0, c = tree.count(n); i < c; i++) {
      const k = tree.child(n, i);
      if (!tree.named(k) || tree.kindName(k).includes("comment")) continue;
      if (unfielded && tree.fieldName(k) !== undefined) continue;
      out.push(k);
    }
    return out;
  };
  const up = (n: number, levels: number) => {
    let p = n;
    for (let i = 0; i < levels && p >= 0; i++) p = tree.parent(p);
    return p;
  };

  const bind = (
    target: number,
    scope: number,
    opaque: boolean,
    holder: number,
  ) => {
    const kind = tree.kindName(target);
    if (references.has(kind) || keyed.has(kind)) {
      if (tree.count(target) !== 0) return void doubts.push(holder);
      binderAt.set(target, binders.length);
      binders.push({
        name: tree.label(target),
        leaf: target,
        scope,
        kept: opaque || keyed.has(kind),
      });
      return;
    }
    const fields = rules.patterns[kind];
    if (fields) {
      for (const f of fields)
        for (const k of f === null
          ? named(target, true)
          : [fieldChild(target, f)])
          if (k !== undefined) bind(k, scope, opaque, holder);
      return;
    }
    // A binding position holding what the rules do not know could bind anything.
    if (!inert.has(kind)) doubts.push(holder);
  };

  for (const n of side.nodes) {
    const kind = tree.kindName(n);
    for (const u of uncertainByKind.get(kind) ?? []) {
      if (u.field !== undefined) {
        const c = fieldChild(n, u.field);
        if (
          c === undefined ||
          (u.label !== undefined && tree.label(c) !== u.label)
        )
          continue;
      }
      if (u.nested) {
        let p = tree.parent(n);
        while (p >= 0 && !blocks.has(tree.kindName(p))) p = tree.parent(p);
        if (
          p < 0 ||
          module.has(tree.kindName(p)) ||
          functions.has(tree.kindName(tree.parent(p)))
        )
          continue;
      }
      doubts.push(n);
    }
    for (const r of byHolder.get(kind) ?? []) {
      if (r.parent !== undefined && tree.kindName(tree.parent(n)) !== r.parent)
        continue;
      if (r.kind !== undefined) {
        const k = fieldChild(n, "kind");
        if (k === undefined || !r.kind.includes(tree.label(k))) continue;
      }
      let opaque = r.opaque === true;
      for (let i = 0, c = tree.count(n); i < c && !opaque; i++)
        if (r.opaqueWith?.includes(tree.kindName(tree.child(n, i))))
          opaque = true;
      let scope: number;
      if (r.scope === "block") {
        scope = tree.parent(n);
        while (scope >= 0 && !blocks.has(tree.kindName(scope))) {
          if (exports.has(tree.kindName(scope))) opaque = true;
          scope = tree.parent(scope);
        }
      } else scope = up(n, r.scope);
      if (scope < 0) {
        doubts.push(n);
        continue;
      }
      if (module.has(tree.kindName(scope))) opaque = true;
      const targets =
        r.field === undefined ? named(n, false) : [fieldChild(n, r.field)];
      for (const t of targets) if (t !== undefined) bind(t, scope, opaque, n);
    }
  }

  // Binders by scope node and name; two of one name in one scope are both kept.
  const inScope = new Map<number, Map<string, number>>();
  binders.forEach((b, i) => {
    let names = inScope.get(b.scope);
    if (!names) inScope.set(b.scope, (names = new Map()));
    const other = names.get(b.name);
    if (other !== undefined) {
      b.kept = true;
      (binders[other] as Binder).kept = true;
    } else names.set(b.name, i);
  });

  const resolved = new Map<number, number>();
  /** Leaves that spell a name without being a binding or a reference the rules resolve. */
  const strays: number[] = [];
  for (const n of side.nodes) {
    if (tree.count(n) !== 0 || !tree.named(n) || binderAt.has(n)) continue;
    const kind = tree.kindName(n);
    if (inert.has(kind) || kind.includes("comment")) continue;
    const p = tree.parent(n);
    const field = tree.fieldName(n);
    if (
      !references.has(kind) ||
      (p >= 0 &&
        field !== undefined &&
        nonRef.get(tree.kindName(p))?.has(field))
    ) {
      strays.push(n);
      continue;
    }
    const name = tree.label(n);
    for (let s = tree.parent(n); s >= 0; s = tree.parent(s)) {
      const b = inScope.get(s)?.get(name);
      if (b !== undefined) {
        resolved.set(n, b);
        break;
      }
    }
  }

  const span = (n: number) => {
    const i = side.index(n);
    return [i, i + (side.size[i] as number)] as const;
  };
  const inside = (n: number, outer: number) => {
    const [a, b] = span(outer);
    const i = side.index(n);
    return a <= i && i < b;
  };
  // A doubt keeps every binder whose scope holds it, and every binder scoped inside its function.
  for (const d of doubts) {
    let f = tree.parent(d);
    while (
      f >= 0 &&
      !functions.has(tree.kindName(f)) &&
      !module.has(tree.kindName(f))
    )
      f = tree.parent(f);
    for (const b of binders)
      if (!b.kept && (inside(d, b.scope) || (f >= 0 && inside(b.scope, f))))
        b.kept = true;
  }
  // A leaf spelling a binder's name in its scope that is neither a binding nor a resolved reference keeps it.
  for (const s of strays) {
    const name = tree.label(s);
    for (const b of binders)
      if (!b.kept && b.name === name && inside(s, b.scope)) b.kept = true;
  }

  const out: Locals = { of: new Map(), scope: [], binding: [] };
  const number = new Map<number, number>();
  binders.forEach((b, i) => {
    if (b.kept) return;
    number.set(i, out.scope.length);
    out.of.set(b.leaf, out.scope.length);
    out.scope.push(b.scope);
    out.binding.push(b.leaf);
  });
  for (const [leaf, b] of resolved) {
    const k = number.get(b);
    if (k !== undefined) out.of.set(leaf, k);
  }
  return out;
}

/**
 * Iso ids over alpha-normalized names, indexed like `side`: equal iff the subtrees have the same kinds, labels and
 * shape once every local whose binder and scope lie inside the subtree is named by its uses. A local still open
 * in the subtree keeps its own name, so two subtrees compare equal only when they rename what they bind. Use-based
 * naming follows Maziarz et al., "Hashing Modulo Alpha-Equivalence" (PLDI 2021): a variable is replaced by the
 * tree of positions it occurs at, closed into the structure at its scope, so a binder inserted elsewhere renumbers
 * nothing. Numbered through `intern` like `isoIds`, under its own key prefix.
 */
export function alphaIds(
  side: Side,
  locals: Locals | undefined,
  intern: Map<string, number>,
): Int32Array {
  const { tree, nodes } = side;
  const key = (k: string) => {
    let id = intern.get(k);
    if (id === undefined) {
      id = intern.size;
      intern.set(k, id);
    }
    return id;
  };
  const ids = new Int32Array(nodes.length);
  const struct = new Int32Array(nodes.length);
  // Open locals of each pending subtree: binder number to the interned tree of its positions.
  const open: (Map<number, number> | undefined)[] = Array.from({
    length: nodes.length,
  });
  const closing = new Map<number, number[]>();
  if (locals)
    locals.scope.forEach((s, b) => {
      const list = closing.get(s);
      if (list) list.push(b);
      else closing.set(s, [b]);
    });
  const here = key("p\0H");
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i] as number;
    const local = locals?.of.get(n);
    if (local !== undefined) {
      struct[i] = key(`s\0${tree.kindName(n)}\0•`);
      open[i] = new Map([[local, here]]);
    } else {
      const kids = side.childrenOf(i);
      let vars: Map<number, string> | undefined;
      kids.forEach((c, k) => {
        const m = open[c];
        if (!m) return;
        vars ??= new Map();
        for (const [b, p] of m) vars.set(b, `${vars.get(b) ?? ""}${k}:${p};`);
        open[c] = undefined;
      });
      let s = `s\0${tree.kindName(n)}\0${tree.label(n)}\0${kids.map((c) => struct[c]).join(",")}`;
      let m: Map<number, number> | undefined;
      if (vars) {
        m = new Map();
        for (const [b, p] of vars) m.set(b, key(`p\0${p}`));
        const closed = (closing.get(n) ?? []).filter((b) => m?.has(b));
        if (closed.length > 0) {
          // In binding order, so the closed names line up by where they are declared, not what they are called.
          closed.sort(
            (a, b) =>
              side.index(locals?.binding[a] as number) -
              side.index(locals?.binding[b] as number),
          );
          s += `\0${closed.map((b) => m?.get(b)).join(",")}`;
          for (const b of closed) m.delete(b);
        }
        if (m.size === 0) m = undefined;
      }
      struct[i] = key(s);
      open[i] = m;
    }
    const m = open[i];
    const free = m
      ? [...m]
          .map(([b, p]) => `${tree.label(locals?.binding[b] as number)}=${p}`)
          .sort()
          .join(",")
      : "";
    ids[i] = key(`a\0${struct[i]}\0${free}`);
  }
  return ids;
}
