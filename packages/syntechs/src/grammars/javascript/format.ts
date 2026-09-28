// JS, TS and TSX's layout in the formatter DSL (src/fmt/dsl/dsl.ts); `pnpm generate` compiles it into fmt.gen.ts.
// Typed against the tsx grammar, whose kinds and fields hold JS's and TS's. A kind whose layout is one of
// prettier's heuristics (member chains, argument expansion, assignment layout, JSX, conditional groups) is a
// `custom` rule, or a child printed `.via` one, written against sink.ts. Each domain's kinds live in
// format/<domain>.ts, its customs in print/<domain>.ts.
import { defineFormat, type FormatSpec } from "../../fmt/dsl/dsl.js";
import type { grammar } from "../tsx/bundle.js";
import { assignment } from "./format/assignment.js";
import { calls } from "./format/calls.js";
import { classes } from "./format/classes.js";
import { functions } from "./format/functions.js";
import { jsx } from "./format/jsx.js";
import { literals } from "./format/literals.js";
import { modules } from "./format/modules.js";
import { objects } from "./format/objects.js";
import { operators } from "./format/operators.js";
import { statements } from "./format/statements.js";
import { types } from "./format/types.js";
import type { JsOptions } from "./print/util.js";

/** One domain's slice of the spec's `structure`. */
export type JsStructure = FormatSpec<typeof grammar, JsOptions>["structure"];

const format = defineFormat<typeof grammar, JsOptions>();

/** JS, TS and TSX as prettier 3.9.9 lays them out. */
export const javascript = format({
  structure: {
    ...statements,
    ...modules,
    ...operators,
    ...types,
    ...objects,
    ...classes,
    ...assignment,
    ...calls,
    ...functions,
    ...jsx,
    ...literals,
  },
  wrapping: {
    class_body: { blankLines: "force" },
  },
});
