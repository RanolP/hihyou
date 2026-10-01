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
const normalize: Normalize = (lexemes, _text, tree) =>
  lexemes.map((l) => {
    const kind = tree.kindName(l.node);
    if (kind === "single_quote_scalar") return `str:${l.text.slice(1, -1).replaceAll("''", "'")}`;
    if (kind === "double_quote_scalar") return `str:${l.text.slice(1, -1).replaceAll('\\"', '"')}`;
    return l.text;
  });

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
