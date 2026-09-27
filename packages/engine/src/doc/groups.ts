import { NO_NODE } from "syntechs/core";
import { type CrossEdit, nameOf } from "../match/cross-file.js";
import type { Tree } from "../parse/tree.js";
import { riskOf, signalsOf } from "./risk.js";
import type { FileDiff, Group } from "./schema.js";
import {
  ancestry,
  calleeOf,
  findChild,
  functionName,
  isIdentifier,
  signatureOwner,
} from "./syntax-context.js";

type FileInfo = Pick<FileDiff, "path" | "oldPath" | "status">;
type Member = { c: CrossEdit; id: number };
/** A group before its edits and risk are filled in, still one of the `Group` kinds. */
type Head = {
  [K in Group["kind"]]: Omit<Extract<Group, { kind: K }>, "edits" | "risk">;
}[Group["kind"]];

/**
 * Edits across files that make one change together. Each edit joins at most one group, claimed in this
 * order: moves, file renames, identifier renames, signature changes.
 */
export function groupEdits(
  files: FileInfo[],
  located: CrossEdit[][],
  ids: Map<CrossEdit, number>,
): Group[] {
  const all = [...new Set(located.flat())].map((c) => ({
    c,
    id: ids.get(c) ?? -1,
  }));
  const taken = new Set<CrossEdit>();
  const free = () => all.filter((m) => !taken.has(m.c));
  const drafts: { head: Head; members: Member[] }[] = [];
  // An edit an earlier group claimed stays there, so no edit ever lands in two groups.
  const add = (head: Head, candidates: Member[]) => {
    const members = candidates.filter((m) => !taken.has(m.c));
    if (members.length === 0) return;
    for (const m of members) taken.add(m.c);
    drafts.push({ head, members });
  };
  const path = (i: number) => files[i]?.path ?? "";
  const oldPath = (i: number) => files[i]?.oldPath ?? path(i);
  /** The edit's node on the head side when it has one, else on the base side, with its tree. */
  const node = ({ edit, ta, tb }: CrossEdit): [Tree, number] | undefined => {
    const b = "b" in edit ? edit.b : undefined;
    if (b !== undefined) return [tb as Tree, b];
    const a = "a" in edit ? edit.a : undefined;
    return a !== undefined ? [ta as Tree, a] : undefined;
  };
  /** The file an edit is shown in: the head side when it has one. */
  const home = ({ c }: Member) => ("new" in c.edit ? c.to : c.from);
  /** The path of `m`'s file on the side `node(m.c)` lies in. */
  const sidePath = (m: Member, file: number) =>
    "b" in m.c.edit && m.c.edit.b !== undefined ? path(file) : oldPath(file);

  const moves = new Map<string, { names: string[]; members: Member[] }>();
  for (const m of all) {
    if (m.c.from === m.c.to) continue;
    const key = `${m.c.from}\0${m.c.to}`;
    const d = moves.get(key) ?? { names: [], members: [] };
    moves.set(key, d);
    d.members.push(m);
    const a = "a" in m.c.edit ? m.c.edit.a : undefined;
    const name =
      m.c.whole && a !== undefined ? nameOf(m.c.ta as Tree, a) : undefined;
    if (name !== undefined) d.names.push(name);
  }
  for (const [key, { names, members }] of moves) {
    const [from = 0, to = 0] = key.split("\0").map(Number);
    add(
      { kind: "move", fromPath: oldPath(from), toPath: path(to), names },
      members,
    );
  }

  for (const [i, f] of files.entries()) {
    if ((f.status !== "renamed" && f.status !== "copied") || !f.oldPath)
      continue;
    const before = importKey(f.oldPath);
    const after = importKey(f.path);
    const members = free().filter(({ c: { edit, ta, tb, from, to } }) => {
      if (
        edit.kind !== "update" ||
        edit.a === undefined ||
        edit.b === undefined
      )
        return false;
      const at = ta as Tree;
      const bt = tb as Tree;
      if (!/^string_(fragment|content)$/.test(at.kindName(edit.a)))
        return false;
      return (
        resolveImport(oldPath(from), at.label(edit.a)) === before &&
        resolveImport(path(to), bt.label(edit.b)) === after
      );
    });
    add(
      {
        kind: "rename-file",
        fromPath: f.oldPath,
        toPath: path(i),
        copy: f.status === "copied",
      },
      members,
    );
  }

  // Renames are bucketed per file, and two files' buckets join only where an import names the other file,
  // so unrelated locals renamed alike stay apart. A property name (`body.data`) belongs to whatever object
  // it is read from, never to a symbol, so it joins no rename.
  const renames = new Map<string, Map<number, Member[]>>();
  for (const m of free()) {
    const { edit } = m.c;
    if (edit.kind !== "update" || edit.a === undefined || edit.b === undefined)
      continue;
    const ta = m.c.ta as Tree;
    const tb = m.c.tb as Tree;
    if (!isIdentifier(ta, edit.a) || !isIdentifier(tb, edit.b)) continue;
    if (ta.label(edit.a) === tb.label(edit.b) || isProperty(tb, edit.b))
      continue;
    const key = `${ta.label(edit.a)}\0${tb.label(edit.b)}`;
    const perFile = renames.get(key) ?? new Map<number, Member[]>();
    renames.set(key, perFile);
    const file = home(m);
    perFile.set(file, [...(perFile.get(file) ?? []), m]);
  }
  const declares = (m: Member) => {
    const n = node(m.c);
    return (
      n !== undefined && n[0].fieldName(n[1]) === "name" && !specifier(...n)
    );
  };
  for (const [key, perFile] of renames) {
    const [from = "", to = ""] = key.split("\0");
    const root = new Map<number, number>();
    const find = (f: number): number => {
      const r = root.get(f);
      return r === undefined || r === f ? f : find(r);
    };
    for (const [y, ms] of perFile) {
      let x: number | undefined;
      for (const m of ms) {
        const n = node(m.c);
        if (!n || !specifier(...n)) continue;
        const target = importedFrom(...n, sidePath(m, y));
        x = [...perFile.keys()].find(
          (f) => f !== y && importKey(path(f)) === target,
        );
        if (x !== undefined) break;
      }
      if (x !== undefined) root.set(find(y), find(x));
    }
    const joined = new Map<number, Member[]>();
    for (const [f, ms] of perFile)
      joined.set(find(f), [...(joined.get(find(f)) ?? []), ...ms]);
    for (const members of joined.values()) {
      if (members.length < 2) continue;
      const first = members.find(declares) ?? members[0];
      add(
        {
          kind: "rename-symbol",
          from,
          to,
          path: first ? path(home(first)) : "",
        },
        members,
      );
    }
  }

  const signatures = new Map<
    string,
    { file: number; name: string; members: Member[] }
  >();
  for (const m of free()) {
    const n = node(m.c);
    const owner = n && signatureOwner(...n);
    const name =
      n && owner !== undefined ? functionName(n[0], owner) : undefined;
    if (name === undefined) continue;
    const file = home(m);
    const key = `${file}\0${name}`;
    const s = signatures.get(key) ?? { file, name, members: [] };
    s.members.push(m);
    signatures.set(key, s);
  }
  // A change inside one signature is never a call site of another, whichever is declared first.
  const inSignature = new Set(
    [...signatures.values()].flatMap((s) => s.members),
  );
  for (const { file, name, members } of signatures.values()) {
    const calls = free().filter((m) => {
      const n = node(m.c);
      const callee = n && calleeOf(...n);
      if (inSignature.has(m) || !n || callee?.name !== name) return false;
      const at = home(m);
      if (at === file) return true;
      // `pad(...)` needs `pad` imported from the declaring file; `P.pad(...)` needs `P` to be its namespace.
      const { object } = callee;
      const [tree] = n;
      if (object !== undefined && tree.count(object) > 0) return false;
      const root = [...ancestry(...n)].at(-1);
      return (
        root !== undefined &&
        imports(tree, root, sidePath(m, at), importKey(sidePath(m, file)), {
          binding: object !== undefined ? tree.label(object) : name,
          namespace: object !== undefined,
        })
      );
    });
    if (calls.length === 0) continue;
    add({ kind: "signature", name, path: path(file) }, [...members, ...calls]);
  }

  return drafts
    .map(({ head, members }): Group => {
      const sorted = members.toSorted((p, q) => p.id - q.id);
      return {
        ...head,
        edits: sorted.map((m) => m.id),
        risk: riskOf(sorted.map((m) => signalsOf(m.c.edit, m.c.ta, m.c.tb))),
      };
    })
    .sort(
      (p, q) =>
        q.risk.score - p.risk.score ||
        p.kind.localeCompare(q.kind) ||
        (p.edits[0] ?? -1) - (q.edits[0] ?? -1),
    );
}

/** A module path with its extension and a trailing `/index` or `/__init__` dropped, as an import names it. */
function importKey(path: string): string {
  return path.replace(/\.[^./]+$/, "").replace(/\/(index|__init__)$/, "");
}

/** A name listed in an import or re-export: `{ pad }`, `export { pad }`, Python's `from .x import pad`. */
function specifier(tree: Tree, n: number): boolean {
  const p = tree.parent(n);
  if (p === NO_NODE) return false;
  if (tree.kindName(p).endsWith("specifier")) return true;
  const pp = tree.parent(p);
  return (
    tree.kindName(p) === "dotted_name" &&
    tree.fieldName(p) !== "module_name" &&
    /^(import_from_statement|aliased_import)$/.test(
      pp === NO_NODE ? "" : tree.kindName(pp),
    )
  );
}

/** A name looked up on an object (`body.data`, Python `body.data`), as against a variable of its own. */
function isProperty(tree: Tree, n: number): boolean {
  return (
    tree.kindName(n) === "property_identifier" ||
    tree.fieldName(n) === "property" ||
    tree.fieldName(n) === "attribute"
  );
}

/** The module a relative import specifier names, as an `importKey`; undefined for a package import. */
function resolveImport(importer: string, spec: string): string | undefined {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return undefined;
  const parts = importer.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return importKey(parts.join("/"));
}

const importKinds = /^(import_statement|import_from_statement)$/;

/**
 * The module named by the import or re-export statement holding `n`, as an `importKey`: a JS/TS `source`
 * string, or a Python relative `module_name` (`.pad` is a sibling, `..x` in the parent package).
 */
function importedFrom(
  tree: Tree,
  n: number,
  importer: string,
): string | undefined {
  for (const p of ancestry(tree, n)) {
    if (tree.kindName(p) === "import_from_statement") {
      const module = findChild(
        tree,
        p,
        (c) => tree.fieldName(c) === "module_name",
      );
      if (module === undefined || tree.kindName(module) !== "relative_import")
        return undefined;
      const count = tree.count(module);
      const prefix = count > 0 ? tree.child(module, 0) : undefined;
      const dotted = count > 1 ? tree.child(module, 1) : undefined;
      const dots = prefix !== undefined ? tree.count(prefix) : 0;
      const up = dots <= 1 ? "./" : "../".repeat(dots - 1);
      const parts: string[] = [];
      if (dotted !== undefined)
        for (let i = 0, k = tree.count(dotted); i < k; i++) {
          const c = tree.child(dotted, i);
          if (isIdentifier(tree, c)) parts.push(tree.label(c));
        }
      return resolveImport(importer, up + parts.join("/"));
    }
    if (!/^(import|export)_statement$/.test(tree.kindName(p))) continue;
    const source = findChild(tree, p, (c) => tree.fieldName(c) === "source");
    const spec =
      source === undefined
        ? undefined
        : findChild(tree, source, (c) =>
            /^string_(fragment|content)$/.test(tree.kindName(c)),
          );
    return spec !== undefined
      ? resolveImport(importer, tree.label(spec))
      : undefined;
  }
  return undefined;
}

/**
 * Whether the module at `root` binds `binding` by a top-level import from the module `target`: as a
 * namespace (`import * as P`) when `namespace` is set, else as a name (`import { pad }`, `from .x import pad`).
 * An aliased import binds its alias only.
 */
function imports(
  tree: Tree,
  root: number,
  importer: string,
  target: string,
  { binding, namespace }: { binding: string; namespace: boolean },
): boolean {
  const binds = (n: number, inNamespace: boolean): boolean => {
    const field = tree.fieldName(n);
    if (field === "source" || field === "module_name") return false;
    const ns = inNamespace || tree.kindName(n) === "namespace_import";
    const count = tree.count(n);
    if (count === 0)
      return (
        ns === namespace && isIdentifier(tree, n) && tree.label(n) === binding
      );
    const alias = findChild(tree, n, (c) => tree.fieldName(c) === "alias");
    if (alias !== undefined) return binds(alias, ns);
    for (let i = 0; i < count; i++)
      if (binds(tree.child(n, i), ns)) return true;
    return false;
  };
  for (let i = 0, count = tree.count(root); i < count; i++) {
    const s = tree.child(root, i);
    if (
      importKinds.test(tree.kindName(s)) &&
      importedFrom(tree, s, importer) === target &&
      binds(s, false)
    )
      return true;
  }
  return false;
}
