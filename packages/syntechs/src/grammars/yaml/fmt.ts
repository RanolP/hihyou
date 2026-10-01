import { type PrettierOptions, prettierDefaults, prettierSettings } from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { sLiteral } from "../../fmt/stream.js";
import type { StreamRule } from "../../fmt/stream-format.js";
import type { Normalize } from "../../fmt/check.js";
import { grammar } from "./bundle.js";
import { language } from "./index.js";
import { isBlank, printYaml, Unsupported } from "./print.js";

const defaults: PrettierOptions = { ...prettierDefaults };

// A quoted scalar means its value whichever quote it is in: print.ts swaps quotes only when the content has no
// escape but `\"`, so undoing `''` and `\"` is all the decoding a respelling needs.
// A flow collection's trailing comma comes and goes with its layout, and a flow mapping pair with no value drops
// its colon (`{b: }` prints `{ b }`): neither changes what the collection holds.
const normalize: Normalize = (lexemes, _text, tree) =>
  lexemes.map((l, i) => {
    const kind = tree.kindName(l.node);
    if (kind === "," && /^[\]}]$/.test(lexemes[i + 1]?.text ?? "")) return undefined;
    if (kind === ":" && tree.kindName(tree.parent(l.node)) === "flow_pair") {
      const pair = tree.parent(l.node);
      let valued = false;
      for (let c = 0; c < tree.count(pair); c++) if (tree.fieldName(tree.child(pair, c)) === "value") valued = true;
      if (!valued) return undefined;
    }
    if (kind === "single_quote_scalar") return `str:${l.text.slice(1, -1).replaceAll("''", "'")}`;
    if (kind === "double_quote_scalar") return `str:${l.text.slice(1, -1).replaceAll('\\"', '"')}`;
    if (kind === "block_scalar") return blockScalar(l.text);
    return l.text;
  });

/**
 * A block scalar as print.ts may respell it: its header's indicators in canonical order, its content moved as a
 * whole to another indent, its trailing blank lines settled by chomping, and a folded scalar's line breaks refolded
 * (so only its words count).
 */
function blockScalar(text: string): string {
  const nl = text.indexOf("\n");
  const head = nl < 0 ? text : text.slice(0, nl);
  const m = /^([|>])([+-]?)(\d?)([+-]?)/.exec(head);
  const header = m ? `${m[1]}${m[3]}${m[2]}${m[4]} ${head.slice(m[0].length).trim()}` : head;
  const lines = nl < 0 ? [] : text.slice(nl + 1).replace(/\s+$/, "").split("\n");
  if (header.startsWith(">")) return `block:${header}:${lines.join(" ").trim().split(/\s+/).join(" ")}`;
  const cut = Math.min(...lines.filter((l) => l.trim() !== "").map((l) => l.length - l.trimStart().length));
  return `block:${header}:${lines.map((l) => l.slice(cut)).join("\n")}`;
}

const base = defineLanguage(grammar, {
  parser: language,
  atoms: ["single_quote_scalar", "double_quote_scalar"],
  lineComments: {},
  defaults,
  settings: prettierSettings,
  normalize,
  layoutBlind: true,
});

/**
 * YAML as prettier 3.9.9's printer lays it out (print.ts), whole from the stream: the printer walks the tree and
 * places comments itself, so the core attaches none. A construct print.ts cannot lay out yet refuses the file.
 */
export const yaml: Language<PrettierOptions> = {
  ...base,
  comments: new Set(),
  lineComments: new Map(),
  stream: {
    rules: new Map<string, StreamRule<PrettierOptions>>([
      [
        "stream",
        (node, ctx) => {
          const out = printYaml(ctx.tree, node, ctx.options);
          if (out !== "") sLiteral(node, out);
        },
      ],
      // An ERROR root can span less than the file (`{? 1,? 2}` keeps only `{? 1`), so its text is no copy of it.
      [
        "ERROR",
        () => {
          throw new Unsupported("a stream that does not parse");
        },
      ],
    ]),
    lists: new Set(),
    finalLine: (ctx) => !isBlank(ctx.tree),
  },
};
