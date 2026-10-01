import { type PrettierOptions, prettierDefaults, prettierSettings } from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { sLiteral } from "../../fmt/stream.js";
import { grammar } from "./bundle.js";
import { language } from "./index.js";
import { printYaml } from "./print.js";

const defaults: PrettierOptions = { ...prettierDefaults };

const base = defineLanguage(grammar, {
  parser: language,
  lineComments: {},
  defaults,
  settings: prettierSettings,
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
    rules: new Map([
      [
        "stream",
        (node, ctx) => {
          const out = printYaml(ctx.tree, node, ctx.options);
          if (out !== "") sLiteral(node, out);
        },
      ],
    ]),
    lists: new Set(),
    finalLine: () => true,
  },
};
