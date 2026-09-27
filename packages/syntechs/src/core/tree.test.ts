import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { language as css } from "../grammars/css/index.js";
import { language as javascript } from "../grammars/javascript/index.js";
import { language as json } from "../grammars/json/index.js";
import { language as python } from "../grammars/python/index.js";
import { language as tsx } from "../grammars/tsx/index.js";
import { language as typescript } from "../grammars/typescript/index.js";
import type { Tree } from "./arena.js";
import { corpus, FETCHED, type GrammarName } from "./corpus.node.js";
import type { Language } from "./language.js";
import { parseSubtree } from "./parser.js";
import { buildTree } from "./tree.js";

const GRAMMARS: [GrammarName, Language][] = [
  ["json", json],
  ["css", css],
  ["javascript", javascript],
  ["typescript", typescript],
  ["tsx", tsx],
  ["python", python],
];

/** The first word where two arenas' records differ, ord by ord, or null. */
function firstDifference(a: Tree, b: Tree): string | null {
  if (a.nodeCount !== b.nodeCount)
    return `nodeCount ${a.nodeCount} vs ${b.nodeCount}`;
  if (a.root !== b.root) return `root ${a.root} vs ${b.root}`;
  const da = (a as unknown as { data: Uint32Array }).data;
  const db = (b as unknown as { data: Uint32Array }).data;
  for (let ord = 0; ord < a.nodeCount; ord++) {
    const h = a.at(ord);
    if (b.at(ord) !== h) return `ord ${ord}: handle ${h} vs ${b.at(ord)}`;
    const words = a.count(h) === 0 ? 5 : 6 + a.count(h);
    for (let i = 0; i < words; i++)
      if (da[h + i] !== db[h + i])
        return `ord ${ord} (${a.kindName(h)}@${a.start(h)}) word ${i}: ${da[h + i]} vs ${db[h + i]}`;
  }
  return null;
}

// A regression here is the parse-time tree drifting from `buildTree`'s on some construct (an alias, an
// inherited field, an extra between nodes, a GLR stretch), which the diff and the formatter would read
// without any error. The inputs whose parse falls back to `buildTree` check nothing, so each grammar must
// also take the parse-time path at least once.
for (const [grammar, lang] of GRAMMARS) {
  describe.skipIf(!FETCHED[grammar].every((f) => existsSync(f)))(
    `the ${grammar} tree built while parsing`,
    () => {
      test("is buildTree's, record for record, over the corpus", () => {
        let direct = 0;
        for (const input of corpus(grammar)) {
          const { subtrees, root, tree } = parseSubtree(lang, input.text);
          if (tree === null) continue;
          direct++;
          expect(
            firstDifference(tree, buildTree(subtrees, root, input.text)),
            input.name,
          ).toBeNull();
        }
        expect(direct).toBeGreaterThan(0);
      }, 120_000);
    },
  );
}
