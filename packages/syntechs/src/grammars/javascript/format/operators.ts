// Assignment, binary, unary, update, yield, await, sequence and ternary operators (customs: print/operators.ts).
import {
  all,
  any,
  custom,
  either,
  firstText,
  group,
  grpParen,
  has,
  indent,
  inOrder,
  line,
  not,
  pred,
  sepBy,
  softline,
  space,
} from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

/** `x.y`, `x[y]` and `x()` of an operand: where prettier breaks inside parentheses around an `await`. */
const headOfChain = any(
  pred("role", "call_expression", "callee"),
  pred("role", "member_expression", "object"),
  pred("role", "subscript_expression", "object"),
);

export const operators = {
  assignment_expression: () => custom("assignment"),
  augmented_assignment_expression: () => custom("assignment"),
  binary_expression: () => custom("binary"),
  update_expression: () => inOrder(),
  yield_expression: ($) => ["yield", "*", $.children.andThen((a) => [space, a])],
  unary_expression: ($) => [
    $.operator,
    either(firstText({ is: ["typeof", "void", "delete"] }), space, []),
    either(pred("commented", "argument"), grpParen($.argument), $.argument),
  ],
  // Prettier's await-expression.js: at the head of a member chain, the await breaks inside parentheses of its
  // own, grouped unless it starts an enclosing await, whose group then decides.
  await_expression: ($) =>
    either(
      all(has("children"), headOfChain),
      either(
        pred("startsAncestor", "await_expression", "statement_block"),
        [indent([softline, "await", space, $.children]), softline],
        group([indent([softline, "await", space, $.children]), softline]),
      ),
      ["await", either(has("children"), [space, $.children], [])],
    ),
  // Prettier's sequence-expression.js: a statement's sequence indents all but its first expression; a returned,
  // thrown or arrow-body one breaks inside the parentheses around it.
  sequence_expression: ($) =>
    either(
      any(pred("role", "expression_statement"), pred("role", "for_statement")),
      group([$.children.at(0).andThen((a) => a), ",", indent([line, sepBy(",", $.children.from(1))])]),
      group(
        either(
          any(
            all(pred("needsParens"), any(pred("role", "return_statement", "argument"), pred("role", "throw_statement", "argument"))),
            pred("role", "arrow_function", "body"),
          ),
          [indent([softline, sepBy(",", $.children)]), softline],
          sepBy(",", $.children),
        ),
      ),
    ),
  ternary_expression: () => custom("ternary"),
  conditional_type: () => custom("ternary"),
} satisfies JsStructure;
