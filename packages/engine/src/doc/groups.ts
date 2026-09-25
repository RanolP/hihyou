import { type CrossEdit, nameOf } from "../match/cross-file.js";
import type { SyntaxNode } from "../parse/tree.js";
import { riskOf, signalsOf } from "./risk.js";
import type { FileDiff, Group } from "./schema.js";
import {
  ancestry,
  calleeOf,
  functionName,
  isExported,
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
  const node = ({ edit }: CrossEdit) =>
    ("b" in edit ? edit.b : undefined) ?? ("a" in edit ? edit.a : undefined);
  /** The file an edit is shown in: the head side when it has one. */
  const home = ({ c }: Member) => ("new" in c.edit ? c.to : c.from);
  /** The path of `m`'s file on the side `node(m.c)` lies in. */
  const sidePath = (m: Member, file: number) =>
    "b" in m.c.edit && m.c.edit.b ? path(file) : oldPath(file);

  const moves = new Map<string, { names: string[]; members: Member[] }>();
  for (const m of all) {
    if (m.c.from === m.c.to) continue;
    const key = `${m.c.from}\0${m.c.to}`;
    const d = moves.get(key) ?? { names: [], members: [] };
    moves.set(key, d);
    d.members.push(m);
    const a = "a" in m.c.edit ? m.c.edit.a : undefined;
    const name = m.c.whole && a ? nameOf(a) : undefined;
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
    const members = free().filter(({ c: { edit, from, to } }) => {
      if (edit.kind !== "update" || !edit.a || !edit.b) return false;
      if (!/^string_(fragment|content)$/.test(edit.a.kind)) return false;
      return (
        resolveImport(oldPath(from), edit.a.label) === before &&
        resolveImport(path(to), edit.b.label) === after
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

  // Renames are bucketed per file, and two files' buckets join only when an import links them, or when
  // one declares the name exported and the other only uses it, so unrelated locals renamed alike stay apart.
  const renames = new Map<string, Map<number, Member[]>>();
  for (const m of free()) {
    const { edit } = m.c;
    if (edit.kind !== "update" || !edit.a || !edit.b) continue;
    if (!isIdentifier(edit.a) || !isIdentifier(edit.b)) continue;
    if (edit.a.label === edit.b.label) continue;
    const key = `${edit.a.label}\0${edit.b.label}`;
    const perFile = renames.get(key) ?? new Map<number, Member[]>();
    renames.set(key, perFile);
    const file = home(m);
    perFile.set(file, [...(perFile.get(file) ?? []), m]);
  }
  const specifier = (n: SyntaxNode | undefined) =>
    /specifier$/.test(n?.parent?.kind ?? "");
  const declares = (m: Member) => {
    const n = node(m.c);
    return n?.field === "name" && !specifier(n);
  };
  const exportedDecl = (m: Member) => {
    const decl = node(m.c)?.parent;
    return declares(m) && decl !== undefined && isExported(decl);
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
        if (!n || !specifier(n)) continue;
        const target = importedFrom(n, sidePath(m, y));
        x = [...perFile.keys()].find(
          (f) => f !== y && importKey(path(f)) === target,
        );
        if (x !== undefined) break;
      }
      if (x === undefined && !ms.some(declares))
        x = [...perFile].find(
          ([f, fm]) => f !== y && fm.some(exportedDecl),
        )?.[0];
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
    const owner = n && signatureOwner(n);
    const name = owner && functionName(owner);
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
      if (inSignature.has(m) || !n || calleeOf(n) !== name) return false;
      const at = home(m);
      if (at === file) return true;
      const target = importKey(sidePath(m, file));
      const root = [...ancestry(n)].at(-1);
      return (
        root !== undefined && importsName(root, sidePath(m, at), name, target)
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
        risk: riskOf(sorted.map((m) => signalsOf(m.c.edit))),
      };
    })
    .sort(
      (p, q) =>
        q.risk.score - p.risk.score ||
        p.kind.localeCompare(q.kind) ||
        (p.edits[0] ?? -1) - (q.edits[0] ?? -1),
    );
}

/** A module path with its extension and a trailing `/index` dropped, as an import names it. */
function importKey(path: string): string {
  return path.replace(/\.[^./]+$/, "").replace(/\/index$/, "");
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

/** The module named by the import or re-export statement holding `n`, as an `importKey`. */
function importedFrom(n: SyntaxNode, importer: string): string | undefined {
  for (const p of ancestry(n)) {
    if (!/^(import|export)_statement$/.test(p.kind)) continue;
    const spec = p.children
      .find((c) => c.field === "source")
      ?.children.find((c) => /^string_(fragment|content)$/.test(c.kind));
    return spec && resolveImport(importer, spec.label);
  }
  return undefined;
}

/** Whether the module at `root` imports `name` from the module `target`. */
function importsName(
  root: SyntaxNode,
  importer: string,
  name: string,
  target: string,
): boolean {
  const names = (n: SyntaxNode): boolean =>
    n.field !== "source" &&
    (n.children.length === 0
      ? isIdentifier(n) && n.label === name
      : n.children.some(names));
  return root.children.some(
    (s) =>
      s.kind === "import_statement" &&
      s.children[0] !== undefined &&
      importedFrom(s.children[0], importer) === target &&
      names(s),
  );
}
