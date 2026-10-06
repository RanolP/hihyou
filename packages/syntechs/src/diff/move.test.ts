import { expect, test } from "vitest";
import { parseTree } from "../core/index.js";
import { language, scope } from "../grammars/typescript/index.js";
import { editScript } from "./edit-script.js";
import { match } from "./matcher.js";
import { classifyMove } from "./move.js";
import { Side } from "./side.js";

const opts = { minAtoms: 4, scope };

/** The mapping between `before` and `after`, and the index on each side of the first node of `kind`. */
function pair(before: string, after: string, kind: string) {
  const a = Side.of(parseTree(language, before));
  const b = Side.of(parseTree(language, after));
  const first = (s: Side) =>
    s.nodes.findIndex((n) => s.tree.kindName(n) === kind);
  return { mapping: match(a, b), x: first(a), y: first(b) };
}

// The dice over every leaf counted `if ( ) { return ( ) ; }` as carried over, so a block whose every word changed
// was classified as moved and edited.
test("a moved block that kept only its shape has no witness", () => {
  const { mapping, x, y } = pair(
    "function run() {\n  if (a) { return f(x); }\n  keep(1, 2, 3);\n}\n",
    "function run() {\n  keep(1, 2, 3);\n  if (b) { return g(y); }\n}\n",
    "if_statement",
  );
  expect(classifyMove(mapping, x, y, opts)).toBeUndefined();
});

// #76: the name pass proposed the rewritten `load` and the punctuation-heavy dice accepted it, so a function whose
// body was replaced read "Moved and edited".
test("a same-named function moved and rewritten is not a move", () => {
  const before = `function load(id: string) {
  const r = fetch(url + id);
  log(r);
  return r.json();
}
function other(n: number) {
  return n * 2;
}
`;
  const after = `function other(n: number) {
  return n * 2;
}
function load(id: string) {
  const v = cache.get(id);
  track(v);
  return v ?? null;
}
`;
  const { mapping } = pair(before, after, "program");
  const moves = editScript(mapping, undefined, opts).edits.filter(
    (e) => e.kind === "move" && e.node === "function_declaration",
  );
  expect(moves).toEqual([]);
});

// A rename shown as "Moved" would hide that the locals changed: equal only up to renames is an edited move.
test("a block moved with its locals renamed is edited, and the same block unchanged is pure", () => {
  const block = (r: string) =>
    `function f() {\n  const ${r} = fetch(u);\n  log(${r});\n  return ${r}.json();\n}\n`;
  const renamed = pair(
    `${block("r")}keep(1, 2, 3);\n`,
    `keep(1, 2, 3);\n${block("res")}`,
    "function_declaration",
  );
  expect(classifyMove(renamed.mapping, renamed.x, renamed.y, opts)?.kind).toBe(
    "edited",
  );
  const same = pair(
    `${block("r")}keep(1, 2, 3);\n`,
    `keep(1, 2, 3);\n${block("r")}`,
    "function_declaration",
  );
  expect(classifyMove(same.mapping, same.x, same.y, opts)?.kind).toBe("pure");
});
