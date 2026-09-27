// Collections and comprehensions: lists, tuples, sets, and dicts.
import { grpBrace, grpBracket, grpParen, tok } from "../../../fmt/dsl/dsl.js";
import type { Structure } from "../format.js";

// Ruff lays out a collection's brackets and items as one frame (`parenthesized`, or `empty_parenthesized` when it
// has none) with its dangling comments after the opening bracket: the frame is `collection.brackets`, and the items
// between the brackets one custom, given the first item. A comprehension's frame is the same.
export const collection = {
  list: ($) =>
    grpBracket($.children.at(0).andThen((c) => c.via("collection.sequence"))).via("collection.brackets"),
  set: ($) =>
    grpBrace($.children.at(0).andThen((c) => c.via("collection.sequence"))).via("collection.brackets"),
  tuple: ($) =>
    grpParen($.children.at(0).andThen((c) => c.via("collection.tuple"))).via("collection.brackets"),
  dictionary: ($) =>
    grpBrace($.children.at(0).andThen((c) => c.via("collection.dict"))).via("collection.brackets"),
  pair: ($) => [$.key.via("collection.pairKey"), ":", $.value.via("collection.pairValue")],
  dictionary_comprehension: ($) =>
    grpBrace($.body.via("collection.dictComp")).via("collection.brackets"),
  list_comprehension: ($) => grpBracket($.body.via("collection.comp")).via("collection.brackets"),
  set_comprehension: ($) => grpBrace($.body.via("collection.comp")).via("collection.brackets"),
  generator_expression: ($) => grpParen($.body.via("collection.comp")).via("collection.brackets"),
  // Ruff's comments around the keywords print with the parts beside them.
  for_in_clause: ($) => [
    tok("async").via("collection.async"),
    "for",
    $.left.via("collection.forTarget"),
    "in",
    $.right.at(0).andThen((r) => r.via("collection.forIter")),
  ],
  if_clause: ($) => ["if", $.children.via("collection.ifTest")],
} satisfies Structure;
