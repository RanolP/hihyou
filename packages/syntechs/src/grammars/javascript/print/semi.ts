import type { TokenRule } from "../../../fmt/dsl/runtime.js";
import { sToken } from "../sink.js";
import type { JsOptions } from "./util.js";

/**
 * A statement's trailing `;`, which a spec writes as `tok(";").via("semi")`: the source's own `;` when it has one,
 * one added when it has none, and neither under `semi: false`. util.ts's semi() is the same rule on the Doc.
 */
const semi: TokenRule<JsOptions> = (token, node, ctx) => {
  const present = token !== undefined && ctx.tree.text(token) !== "";
  if (!ctx.options.semi) {
    if (present) sToken(token, "");
    return;
  }
  if (present) sToken(token, ";");
  else sToken(node, ";", true);
};

export const semiCustoms = { semi };
