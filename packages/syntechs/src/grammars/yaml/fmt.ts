import { parseTree } from "../../core/index.js";
import { SYM_ERROR } from "../../core/language.js";
import { brokenNodes } from "../../fmt/format.js";
import { type PrettierOptions, prettierDefaults, prettierSettings } from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { sLiteral } from "../../fmt/stream.js";
import type { StreamRule } from "../../fmt/stream-format.js";
import type { Normalize } from "../../fmt/check.js";
import { grammar } from "./bundle.js";
import { language } from "./index.js";
import { fold, isBlank, printYaml, Unsupported } from "./print.js";

const defaults: PrettierOptions = { ...prettierDefaults };

// A quoted scalar means its value whichever quote it is in: print.ts swaps quotes only when the content has no
// escape but `\"`, so undoing `''` and `\"` is all the decoding a respelling needs.
// A flow collection's trailing comma comes and goes with its layout, and a flow mapping pair with no value drops
// its colon (`{b: }` prints `{ b }`): neither changes what the collection holds. A pair's `?` comes and goes with
// its key's layout, and so does the colon of a pair with no value (`? a` prints `a:`).
// A comment in a flow collection trails the comma or colon its line ends in, whichever side of it the source had
// it on (`[a # c⏎, b]` prints `a, # c`), so a flow comma or a flow pair's colon beside a comment does not count.
const normalize: Normalize = (lexemes, _text, tree) =>
  lexemes.map((l, i) => {
    const kind = tree.kindName(l.node);
    if (kind === "," && /^[\]}]$/.test(lexemes[i + 1]?.text ?? "")) return undefined;
    const besideComment = [lexemes[i - 1], lexemes[i + 1]].some((k) => k !== undefined && tree.kindName(k.node) === "comment");
    if (besideComment && (kind === "," || (kind === ":" && tree.kindName(tree.parent(l.node)) === "flow_pair"))) return undefined;
    if (kind === "?" && /^(?:flow|block_mapping)_pair$/.test(tree.kindName(tree.parent(l.node)))) return undefined;
    if (kind === ":" && /^(?:flow|block_mapping)_pair$/.test(tree.kindName(tree.parent(l.node)))) {
      const pair = tree.parent(l.node);
      let valued = false;
      for (let c = 0; c < tree.count(pair); c++) if (tree.fieldName(tree.child(pair, c)) === "value") valued = true;
      if (!valued) return undefined;
    }
    // A directive prints its name and parameters one space apart.
    if (kind.endsWith("_directive") || tree.kindName(tree.parent(l.node)).endsWith("_directive")) return l.text.trim().split(/[ \t]+/).join(" ");
    if (kind === "plain_scalar") return fold(l.text);
    if (kind === "single_quote_scalar") return `str:${fold(l.text.slice(1, -1).replaceAll("''", "'"))}`;
    if (kind === "double_quote_scalar") return `str:${fold(l.text.slice(1, -1).replaceAll('\\"', '"'))}`;
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
  atoms: ["plain_scalar", "single_quote_scalar", "double_quote_scalar"],
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
      // An ERROR root can span less than the file, so its text is no copy of it.
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

/**
 * YAML text as oxfmt prints it embedded in another file's front matter, without a final line break; undefined
 * when it does not parse, where prettier keeps the whole front matter as written. A construct print.ts cannot lay
 * out throws `Unsupported`, so the embedding file is refused rather than printed wrong.
 */
export function formatYaml(value: string, options: Partial<PrettierOptions> = {}): string | undefined {
  const tree = parseTree(language, value);
  if (tree.errorChars > 0 || tree.kind(tree.root) === SYM_ERROR || brokenNodes(tree) !== undefined) return undefined;
  return printYaml(tree, tree.root, { ...defaults, ...options });
}
