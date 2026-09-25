import { type CrossEdit, nameOf } from "../match/cross-file.js";
import { riskOf, signalsOf } from "./risk.js";
import type { FileDiff, Group } from "./schema.js";
import {
  calleeOf,
  functionName,
  isIdentifier,
  signatureOwner,
} from "./syntax-context.js";

type FileInfo = Pick<FileDiff, "path" | "oldPath" | "status">;
type Member = { c: CrossEdit; id: number };
type Draft = Group extends infer G
  ? G extends Group
    ? Omit<G, "edits" | "risk"> & { members: Member[] }
    : never
  : never;

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
  const drafts: Draft[] = [];
  const add = (d: Draft) => {
    for (const m of d.members) taken.add(m.c);
    drafts.push(d);
  };
  const path = (i: number) => files[i]?.path ?? "";
  const oldPath = (i: number) => files[i]?.oldPath ?? path(i);
  const node = ({ edit }: CrossEdit) =>
    ("b" in edit ? edit.b : undefined) ?? ("a" in edit ? edit.a : undefined);
  /** The file an edit is shown in: the head side when it has one. */
  const home = ({ c }: Member) => ("new" in c.edit ? c.to : c.from);

  const moves = new Map<string, Draft & { kind: "move" }>();
  for (const m of all) {
    if (m.c.from === m.c.to) continue;
    const key = `${m.c.from}\0${m.c.to}`;
    let d = moves.get(key);
    if (!d) {
      d = {
        kind: "move",
        fromPath: oldPath(m.c.from),
        toPath: path(m.c.to),
        names: [],
        members: [],
      };
      moves.set(key, d);
    }
    d.members.push(m);
    const a = "a" in m.c.edit ? m.c.edit.a : undefined;
    const name = m.c.whole && a ? nameOf(a) : undefined;
    if (name !== undefined) d.names.push(name);
  }
  for (const d of moves.values()) add(d);

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
    add({
      kind: "rename-file",
      fromPath: f.oldPath,
      toPath: path(i),
      copy: f.status === "copied",
      members,
    });
  }

  const renames = new Map<string, Member[]>();
  for (const m of free()) {
    const { edit } = m.c;
    if (edit.kind !== "update" || !edit.a || !edit.b) continue;
    if (!isIdentifier(edit.a) || !isIdentifier(edit.b)) continue;
    if (edit.a.label === edit.b.label) continue;
    const key = `${edit.a.label}\0${edit.b.label}`;
    renames.set(key, [...(renames.get(key) ?? []), m]);
  }
  for (const [key, members] of renames) {
    if (members.length < 2) continue;
    const [from = "", to = ""] = key.split("\0");
    const declares = members.find(({ c }) => {
      const n = node(c);
      return n?.field === "name" && !/specifier$/.test(n.parent?.kind ?? "");
    });
    const first = declares ?? members[0];
    add({
      kind: "rename-symbol",
      from,
      to,
      path: first ? path(home(first)) : "",
      members,
    });
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
  for (const { file, name, members } of signatures.values()) {
    const calls = free().filter((m) => {
      const n = node(m.c);
      return !members.includes(m) && n !== undefined && calleeOf(n) === name;
    });
    if (calls.length === 0) continue;
    add({
      kind: "signature",
      name,
      path: path(file),
      members: [...members, ...calls],
    });
  }

  const groups = drafts.map(({ members, ...g }): Group => {
    const sorted = members.toSorted((p, q) => p.id - q.id);
    return {
      ...g,
      edits: sorted.map((m) => m.id),
      risk: riskOf(sorted.map((m) => signalsOf(m.c.edit))),
    } as Group;
  });
  const seen = new Set<number>();
  for (const g of groups)
    for (const id of g.edits) {
      if (seen.has(id)) throw new Error(`edit ${id} is in two groups`);
      seen.add(id);
    }
  return groups.sort(
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
