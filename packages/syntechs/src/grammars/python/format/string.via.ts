// The customs string.ts's `.via`s name.
import type { Str } from "../fmt/ast.js";
import { hooks } from "../fmt/expr.js";
import { part, ruffOf } from "../fmt/sink.js";
import { formatStr } from "../fmt/strings.js";

export const stringVia = {
  "string.str": (c: number) => {
    const { f, e } = ruffOf(c);
    part(formatStr(f, e as Str, hooks));
  },
};
