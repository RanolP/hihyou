// Collections and comprehensions: lists, tuples, sets, and dicts.
import type { Structure } from "../format.js";

// Ruff's brackets hold a group that leaves them out, so the brackets are tokens here and the items between them one
// custom, given the first item; an empty collection stays on ruff's `empty_parenthesized`.
export const collection = {
  list: ($) => ["[", $.children.at(0).andThen((c) => c.via("collection.sequence")), "]"],
  set: ($) => ["{", $.children.at(0).andThen((c) => c.via("collection.sequence")), "}"],
  tuple: ($) => ["(", $.children.at(0).andThen((c) => c.via("collection.tuple")), ")"],
  dictionary: ($) => ["{", $.children.at(0).andThen((c) => c.via("collection.dict")), "}"],
  pair: ($) => [$.key.via("collection.pairKey"), ":", $.value.via("collection.pairValue")],
  dictionary_comprehension: ($) => ["{", $.body.via("collection.dictComp"), "}"],
} satisfies Structure;
