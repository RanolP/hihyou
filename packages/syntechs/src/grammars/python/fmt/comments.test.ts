import { expect, it } from "vitest";
import { parseTree } from "../../../core/index.js";
import { python } from "../fmt.js";
import { language } from "../index.js";

/** Each comment of `text`, as how and on which tree-sitter node the placement pass puts it. */
function placed(text: string): string[] {
  const tree = parseTree(language, text);
  const isComment = (n: number) => tree.kindName(n) === "comment";
  const p = python.placeComments(tree, isComment, python.defaults);
  const out: string[] = [];
  const walk = (n: number) => {
    const a = p.of(n);
    for (const c of a?.leading ?? []) out.push(`${tree.text(c)} leading ${tree.kindName(n)}`);
    for (const c of p.dangling(n)) out.push(`${tree.text(c)} dangling ${tree.kindName(n)}`);
    for (const c of a?.trailing ?? []) out.push(`${tree.text(c)} trailing ${tree.kindName(n)}`);
    for (let i = 0; i < tree.count(n); i++) walk(tree.child(n, i));
  };
  walk(tree.root);
  return out;
}

// Ruff's comprehension with `if`s ends past its tree-sitter `for_in_clause`, so no tree-sitter node has its range:
// a mapping by range alone finds none and drops the comments ruff attaches to it, which then never print.
it("keeps the comments ruff attaches to a comprehension with ifs, on its for_in_clause", () => {
  expect(placed("[x for x in y if a\n # c\n if b]\n")).toEqual(["# c dangling for_in_clause"]);
  expect(placed("[x for x in y if  # c\n a]\n")).toEqual(["# c dangling for_in_clause"]);
  expect(placed("[\n x\n # c\n for x in y if a]\n")).toEqual(["# c leading for_in_clause"]);
});
