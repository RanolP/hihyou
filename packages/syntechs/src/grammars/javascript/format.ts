// JS, TS and TSX's layout in the formatter DSL (src/fmt/dsl/dsl.ts); `pnpm generate` compiles it into fmt.gen.ts.
// Typed against the tsx grammar, whose kinds and fields hold JS's and TS's. A kind whose layout is one of
// prettier's heuristics (member chains, argument expansion, assignment layout, JSX, conditional groups) is a
// `custom` rule, or a child printed `.via` one, written against sink.ts; the kinds not yet here still print by
// the Doc rules of print/**.
import { custom, defineFormat, inOrder, space } from "../../fmt/dsl/dsl.js";
import type { grammar } from "../tsx/bundle.js";
import type { JsOptions } from "./print/util.js";

const format = defineFormat<typeof grammar, JsOptions>();

/** JS, TS and TSX as prettier 3.9.9 lays them out. */
export const javascript = format({
  structure: {
    finally_clause: ($) => ["finally", space, $.body],

    update_expression: () => inOrder(),
    yield_expression: ($) => ["yield", "*", $.children.andThen((a) => [space, a])],
    unary_expression: () => custom("unary"),
    await_expression: () => custom("await"),
    sequence_expression: () => custom("sequence"),
    ternary_expression: () => custom("ternary"),
    conditional_type: () => custom("ternary"),
  },
});
