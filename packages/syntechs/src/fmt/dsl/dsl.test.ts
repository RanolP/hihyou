import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { parseTree } from "../../core/index.js";
import { type JsonOptions, json } from "../../grammars/json/fmt.js";
import { grammar as jsonGrammar, language as jsonLanguage } from "../../grammars/json/index.js";
import { format as formatTree } from "../format.js";
import type { Language } from "../rules.js";
import { close, GROUP, INDENT, open, SOFT, sLine } from "../stream.js";
import type { StreamRules } from "../stream-format.js";
import {
  all,
  any,
  bail,
  type DslGrammar,
  defineFormat,
  either,
  fieldIs,
  grpBrace,
  grpBracket,
  grpParen,
  has,
  inOrder,
  lines,
  not,
  option,
  parentIs,
  sepBy,
  space,
  splitOn,
  text,
  tok,
  verbatim,
  when,
} from "./dsl.js";
import { emit } from "./emit.js";
import { referenceRules } from "./reference.js";
import type { FrameRule, PredicateRule } from "./runtime.js";

// Written out rather than imported: this project reads the bundles without allowJs, so their types are `any`
// here. The shapes are node-types.json's, as the bundle's `fieldTypes` and `childTypes` carry them.
const slot = <R extends boolean, M extends boolean>(required: R, multiple: M) =>
  ({ required, multiple, types: [] as string[] }) as const;
const grammar = {
  kinds: ["document", "object", "pair", "if_statement", "else_clause", "block"],
  tokens: [",", ":", "{", "}", "if", "else"],
  fields: {},
  comments: [],
  fieldTypes: {
    pair: { key: slot(true, false), value: slot(true, false) },
    if_statement: {
      condition: slot(true, false),
      consequence: slot(true, false),
      alternative: slot(false, false),
    },
    else_clause: { body: slot(true, false) },
  },
  childTypes: { object: slot(false, true), block: slot(false, true) },
} as const;
interface Options {
  bracketSpacing: boolean;
  objectWrap: "preserve" | "collapse";
}
const format = defineFormat<typeof grammar, Options>();

// A spec naming what its grammar or options lack would print nothing there, or crash at generate time; the
// typecheck rejects it instead. Each `@ts-expect-error` fails `tsc -b` once its line stops being an error.
it("a typo'd kind, field, token, separator or option fails to typecheck, so a spec never silently drops a slot", () => {
  const specs = () => [
    format({
      structure: {
        // @ts-expect-error: `pairs` is not a kind
        pairs: () => [],
      },
    }),
    format({
      structure: {
        // @ts-expect-error: `pair` has no field `val`
        pair: ($) => [$.key, ":", space, $.val],
      },
    }),
    format({
      structure: {
        // @ts-expect-error: `;` is not a token
        pair: ($) => [$.key, ";", space, $.value],
      },
    }),
    format({
      structure: {
        // @ts-expect-error: `;` is not a token, printed through a rule or not
        pair: ($) => [$.key, ":", space, $.value, tok(";").via("semi")],
      },
    }),
    format({
      structure: {
        // @ts-expect-error: the separator `;` is not a token
        object: ($) => grpBrace(sepBy(";", $.children)),
      },
    }),
    format({
      structure: {
        // @ts-expect-error: `bracketSpaceing` is not an option
        object: ($) => grpBrace(sepBy(",", $.children), { pad: option("bracketSpaceing") }),
      },
    }),
    format({
      structure: {
        // @ts-expect-error: `objectWrap` is never "always"
        object: ($) => grpBrace(sepBy(",", $.children, { trailing: option("objectWrap").is("always") })),
      },
    }),
    format({
      structure: {
        // A required field is a node, an optional one an Option printed through `andThen`, a list only through a
        // list idiom: this spec is well typed.
        if_statement: ($) => [
          "if",
          grpParen($.condition),
          space,
          $.consequence,
          $.alternative.andThen((a) => [space, a]),
        ],
        object: ($) =>
          grpBrace(sepBy(",", $.children), { pad: option("bracketSpacing") }),
      },
      wrapping: { object: { keepExpanded: option("objectWrap").is("preserve") } },
    }),
    format({
      // A `text` whose `when` names a kind or option the grammar lacks never holds, so it silently never respells.
      structure: {
        // @ts-expect-error: `objects` is not a kind
        pair: () => text("lower", parentIs("objects")),
      },
    }),
    format({
      structure: {
        // @ts-expect-error: `bracketSpaceing` is not an option
        pair: () => text("lower", option("bracketSpaceing")),
      },
    }),
    format({
      structure: {
        // @ts-expect-error: `objects` is not a kind, under a `has` inside a combinator
        pair: () => text("lower", not(has("children", "objects"))),
      },
    }),
    format({
      structure: {
        // @ts-expect-error: `lowercase` is not a normalizer
        pair: () => text("lowercase"),
      },
    }),
    format({
      structure: {
        document: () => text("lower", parentIs("object")),
        pair: () => text("printNumber", option("bracketSpacing")),
        object: () => text("trimEnd"),
      },
    }),
    format({
      structure: {
        // @ts-expect-error: an Option is not a node
        if_statement: ($) => ["if", $.condition, $.alternative],
      },
    }),
    format({
      structure: {
        // @ts-expect-error: a list is not a node
        block: ($) => ["{", $.children, "}"],
      },
    }),
  ];
  expect(specs).toBeTypeOf("function");
});

// An `.at` the IR loses prints the first child wherever the spec names a later one.
it("`.at` reaches the IR, with a `.via` after it", () => {
  const ir = format({
    structure: {
      object: ($) => $.children.at(1).andThen((c) => [space, c.via("second")]),
    },
  });
  expect(ir.structure["object"]).toEqual({
    t: "opt",
    ref: { t: "ref", name: "children", at: 1 },
    then: { t: "seq", parts: [expect.anything(), { t: "ref", name: "children", at: 1, via: "second" }] },
  });
});

// A `.split` the IR loses prints a slice's upper bound as its lower one, since `a:` and `:a` hold one child each.
it("`.split` reaches the IR with its `.at`, and a `.via` after them", () => {
  const ir = format({
    structure: {
      object: ($) => [":", $.children.split(":").at(1).andThen((c) => c.via("bound"))],
    },
  });
  expect(ir.structure["object"]).toEqual({
    t: "seq",
    parts: [
      expect.anything(),
      {
        t: "opt",
        ref: { t: "ref", name: "children", at: 1, split: ":" },
        then: { t: "ref", name: "children", at: 1, split: ":", via: "bound" },
      },
    ],
  });
});

// A `.via` the IR loses prints the child by its own rule, silently skipping the custom its parent named.
it("`.via` reaches the IR on a required field and inside `andThen`", () => {
  const ir = format({
    structure: {
      if_statement: ($) => [
        $.condition.via("cond"),
        $.alternative.andThen((a) => [space, a.via("alt")]),
      ],
    },
  });
  expect(ir.structure["if_statement"]).toEqual({
    t: "seq",
    parts: [
      { t: "ref", name: "condition", via: "cond" },
      {
        t: "opt",
        ref: { t: "ref", name: "alternative" },
        then: {
          t: "seq",
          parts: [expect.anything(), { t: "ref", name: "alternative", via: "alt" }],
        },
      },
    ],
  });
});

// A `when` the IR loses respells the text everywhere: CSS would lowercase every class name, not only a pseudo-class's.
it("`text(fn, when)` reaches the IR with its condition, and without one holds everywhere", () => {
  const ir = format({
    structure: {
      pair: () => text("lower", parentIs("object")),
      object: () => text("printNumber"),
    },
  });
  expect(ir.structure["pair"]).toEqual({ t: "text", fn: "lower", when: { t: "parent", kind: "object" } });
  expect(ir.structure["object"]).toEqual({ t: "text", fn: "printNumber", when: true });
});

// A `tok(...).via` the IR loses prints the source token as written, silently skipping the rule that inserts or drops it.
it("`tok(text).via(name)` reaches the IR as a token printed through its rule", () => {
  const ir = format({ structure: { pair: ($) => [$.key, ":", $.value, tok(",").via("comma")] } });
  expect(ir.structure["pair"]).toEqual({
    t: "seq",
    parts: [expect.anything(), expect.anything(), expect.anything(), { t: "tok", text: ",", via: "comma" }],
  });
});

// A frame's `.via` that the generated code runs differently from the reference, or skips for an empty list, would
// print the brackets or the body where the rule did not put them, or lose an empty list's dangling comments
// (Python's `f(  # c\n)`), which only the frame's rule prints.
it("a bracket frame's `.via` rule runs for an empty body too, and the generated code prints what the reference prints", async () => {
  const ir = defineFormat<typeof jsonGrammar, JsonOptions>()({
    structure: {
      document: ($) => lines($.children),
      object: ($) => grpBrace(sepBy(",", $.children)).via("frame"),
      array: ($) => grpBracket(sepBy(",", $.children)).via("frame"),
      pair: ($) => [$.key, ":", space, $.value],
      string: () => verbatim,
      number: () => verbatim,
    },
  });
  // Plain data: the builder's `via` method stays out of the IR.
  expect(JSON.parse(JSON.stringify(ir.structure["array"]))).toEqual(ir.structure["array"]);
  expect(ir.structure["array"]).toMatchObject({ t: "brackets", open: "[", via: "frame" });

  let runs = 0;
  // Ruff's `parenthesized` in brief: the brackets around an indented body, all in one group.
  const frame: FrameRule = (_, __, f) => {
    runs++;
    open(GROUP);
    f.open();
    open(INDENT);
    sLine(SOFT);
    f.body();
    close();
    sLine(SOFT);
    f.close();
    close();
  };
  // The generated module imports its runtime relative to a folder two below src/, as fmt.gen.ts does from its
  // grammar's; written beside this test for the run.
  const file = join(import.meta.dirname, "frame-equivalence.gen.ts");
  writeFileSync(file, emit({ frame: ir }, jsonGrammar as DslGrammar, "dsl.test.ts"));
  try {
    const gen = (await import(pathToFileURL(file).href)) as {
      frame: (custom: { frame: FrameRule<JsonOptions> }) => StreamRules<JsonOptions>;
    };
    const generated = { ...json, stream: gen.frame({ frame }) };
    const reference = {
      ...json,
      stream: referenceRules<JsonOptions>(ir, jsonGrammar as DslGrammar, { frame }),
    };
    const run = (text: string, lang: Language<JsonOptions>, o: Partial<JsonOptions>) =>
      formatTree(parseTree(jsonLanguage, text), lang, o);
    const texts = [
      "[]",
      "{}",
      "[ // x\n]",
      "{/* d */}",
      '{"a": [1, 2], "b": {"c": [3, // y\n4]}}',
      `[${"1234567890, ".repeat(12)}1]`,
    ];
    for (const text of texts)
      for (const o of [{}, { printWidth: 20 }]) {
        runs = 0;
        const out = run(text, generated, o);
        expect(runs, text).toBeGreaterThan(0);
        expect(out, text).toEqual(run(text, reference, o));
      }
  } finally {
    rmSync(file);
  }
});

// CSS's at-rules, feature queries and combinators are `inOrder`s with spacing rules: generated code that applied
// them in another precedence than the reference, lost a verbatim child's comments, or printed an `except` kind raw
// would respace or reformat them.
it("`inOrder`'s spacing rules apply tight, then spaceWhen, then join, and the generated code prints what the reference prints", async () => {
  const ir = defineFormat<typeof jsonGrammar, JsonOptions>()({
    structure: {
      document: ($) => lines($.children),
      // After `{` both rules claim the pair and `tight` wins; after `,` only `spaceWhen` does.
      object: () =>
        inOrder({ join: "gap", tight: { after: ["{"], before: ["}", ","] }, spaceWhen: { after: ["{", ","] } }),
      pair: () => inOrder({ join: "gap", spaceWhen: { when: when("spaced") } }),
      array: () => inOrder({ join: "line", tight: { after: ["["], before: ["]", ","] }, verbatim: { except: ["object"] } }),
      string: () => verbatim,
      number: () => verbatim,
    },
    wrapping: { array: { group: true } },
  });
  const spaced: PredicateRule = (node, ctx) => ctx.tree.text(ctx.items(node)[0] as number) === '"s"';
  const file = join(import.meta.dirname, "in-order-equivalence.gen.ts");
  writeFileSync(file, emit({ inOrder: ir }, jsonGrammar as DslGrammar, "dsl.test.ts"));
  try {
    const gen = (await import(pathToFileURL(file).href)) as {
      inOrder: (custom: { spaced: PredicateRule<JsonOptions> }) => StreamRules<JsonOptions>;
    };
    const generated = { ...json, stream: gen.inOrder({ spaced }) };
    const reference = { ...json, stream: referenceRules<JsonOptions>(ir, jsonGrammar as DslGrammar, { spaced }) };
    const run = (text: string, lang: Language<JsonOptions>, o: Partial<JsonOptions>) => {
      const out = formatTree(parseTree(jsonLanguage, text), lang, o);
      if (!out.ok) throw new Error(out.detail);
      return out.text;
    };
    const cases: [string, Partial<JsonOptions>, string][] = [
      // A gap where the source has one, and `when` spacing every pair of the `"s"` pair.
      ['{ "a" :1,"s":2 }', {}, '{"a" :1, "s" : 2}\n'],
      // Named children as their source text between their comments, but an `except` kind as its rule prints it.
      ['[[1,  2], { "a":1 }, /* c */ 3]', {}, '[[1,  2], {"a":1}, /* c */ 3]\n'],
      // A `line` join breaks with its group.
      ['[[1,  2], { "a":1 }, /* c */ 3]', { printWidth: 20 }, '[[1,  2],\n{"a":1},\n/* c */ 3]\n'],
    ];
    for (const [text, o, want] of cases) {
      expect(run(text, generated, o), text).toBe(want);
      expect(run(text, reference, o), text).toBe(want);
    }
  } finally {
    rmSync(file);
  }
});

// A combinator the generated code evaluated differently from the reference (an `any` read as `all`, a `not`
// dropped, `has` reading the wrong children) would respell where the spec says not to.
it("`not`, `all`, `any`, `fieldIs` and `has` hold where the reference says, in the generated code", async () => {
  const ir = defineFormat<typeof jsonGrammar, JsonOptions>()({
    structure: {
      document: ($) => lines($.children),
      object: ($) => grpBrace(sepBy(",", $.children)),
      pair: ($) => [$.key, ":", space, $.value],
      // A key, but not one inside an array's object, and never under the `keep` predicate.
      string: () =>
        text("lower", all(fieldIs("key"), not(any(when("keep"), has("value", "array"))))),
      // An array respells when it holds a string, or when it is a pair's value holding an object.
      array: () => text("lower", any(has("children", "string"), all(fieldIs("value"), has("children", "object")))),
      number: () => verbatim,
    },
  });
  const keep: PredicateRule = (node, ctx) => ctx.tree.text(node) === '"K"';
  const file = join(import.meta.dirname, "logic-equivalence.gen.ts");
  writeFileSync(file, emit({ logic: ir }, jsonGrammar as DslGrammar, "dsl.test.ts"));
  try {
    const gen = (await import(pathToFileURL(file).href)) as {
      logic: (custom: { keep: PredicateRule<JsonOptions> }) => StreamRules<JsonOptions>;
    };
    const generated = { ...json, stream: gen.logic({ keep }) };
    const reference = { ...json, stream: referenceRules<JsonOptions>(ir, jsonGrammar as DslGrammar, { keep }) };
    const run = (text: string, lang: Language<JsonOptions>) => {
      const out = formatTree(parseTree(jsonLanguage, text), lang, {});
      if (!out.ok) throw new Error(out.detail);
      return out.text;
    };
    const text = '{"A": "B", "K": 1, "C": ["X", 1], "D": [1], "E": [{"F": 2}]}';
    const want = '{"a": "B", "K": 1, "c": ["x", 1], "d": [1], "e": [{"f": 2}]}\n';
    expect(run(text, generated)).toBe(want);
    expect(run(text, reference)).toBe(want);
  } finally {
    rmSync(file);
  }
});

// A `synth` token the generated code printed where its condition fails, or an `andThen` whose parts it printed
// without the token, would keep a `:` (and its space) the spec drops.
it("`tok(t).synth(when).andThen(f)` prints the token and `f` exactly where the reference does", async () => {
  const ir = defineFormat<typeof jsonGrammar, JsonOptions>()({
    structure: {
      document: ($) => lines($.children),
      object: ($) => grpBrace(sepBy(",", $.children)),
      pair: ($) => [$.key, tok(":").synth(not(has("value", "array"))).andThen((c) => [c, space]), $.value],
      array: ($) => grpBracket(sepBy(",", $.children)),
      string: () => verbatim,
      number: () => verbatim,
    },
  });
  const file = join(import.meta.dirname, "tok-if-equivalence.gen.ts");
  writeFileSync(file, emit({ tokIf: ir }, jsonGrammar as DslGrammar, "dsl.test.ts"));
  try {
    const gen = (await import(pathToFileURL(file).href)) as {
      tokIf: (custom: object) => StreamRules<JsonOptions>;
    };
    const generated = { ...json, stream: gen.tokIf({}) };
    const reference = { ...json, stream: referenceRules<JsonOptions>(ir, jsonGrammar as DslGrammar, {}) };
    const run = (text: string, lang: Language<JsonOptions>) => {
      const out = formatTree(parseTree(jsonLanguage, text), lang, {});
      if (!out.ok) throw new Error(out.detail);
      return out.text;
    };
    const text = '{"a":1, "b":[2]}';
    const want = '{"a": 1, "b"[2]}\n';
    expect(run(text, generated)).toBe(want);
    expect(run(text, reference)).toBe(want);
  } finally {
    rmSync(file);
  }
});

// Kotlin's parameter lists print their last separator this way: without it a broken list would lose ktfmt's
// trailing comma, or a flat one would keep a stray comma before its `)`.
it("`splitOn`'s `trailing` prints the last separator only while the group breaks, where the reference does", async () => {
  const ir = defineFormat<typeof jsonGrammar, JsonOptions>()({
    structure: {
      document: ($) => lines($.children),
      array: () => grpBracket(splitOn(",", { except: ["[", "]"], trailing: true, layout: { between: "line" } })),
      number: () => verbatim,
    },
  });
  const file = join(import.meta.dirname, "split-trailing-equivalence.gen.ts");
  writeFileSync(file, emit({ splitTrailing: ir }, jsonGrammar as DslGrammar, "dsl.test.ts"));
  try {
    const gen = (await import(pathToFileURL(file).href)) as {
      splitTrailing: (custom: object) => StreamRules<JsonOptions>;
    };
    for (const stream of [gen.splitTrailing({}), referenceRules<JsonOptions>(ir, jsonGrammar as DslGrammar, {})]) {
      const run = (text: string, o: Partial<JsonOptions>) => {
        const out = formatTree(parseTree(jsonLanguage, text), { ...json, stream }, o);
        if (!out.ok) throw new Error(out.detail);
        return out.text;
      };
      expect(run("[1,2]", {})).toBe("[1, 2]\n");
      expect(run("[1234567, 1234567]", { printWidth: 10 })).toBe("[\n  1234567,\n  1234567,\n]\n");
    }
  } finally {
    rmSync(file);
  }
});

// A `bail` that did not throw, or threw where its condition fails, would format input the spec must leave alone
// (Python 2), or leave alone input it formats.
it("`bail(reason, when)` leaves the file unformatted exactly where the reference does", async () => {
  const ir = defineFormat<typeof jsonGrammar, JsonOptions>()({
    structure: {
      document: ($) => lines($.children),
      array: ($) => [bail("nested", parentIs("array")), grpBracket(sepBy(",", $.children))],
      number: () => verbatim,
    },
  });
  const file = join(import.meta.dirname, "bail-equivalence.gen.ts");
  writeFileSync(file, emit({ bail: ir }, jsonGrammar as DslGrammar, "dsl.test.ts"));
  try {
    const gen = (await import(pathToFileURL(file).href)) as {
      bail: (custom: object) => StreamRules<JsonOptions>;
    };
    for (const stream of [gen.bail({}), referenceRules<JsonOptions>(ir, jsonGrammar as DslGrammar, {})]) {
      const run = (text: string) => formatTree(parseTree(jsonLanguage, text), { ...json, stream }, {});
      expect(run("[1]")).toMatchObject({ ok: true, text: "[1]\n" });
      expect(run("[[1]]")).toMatchObject({ ok: false, reason: "formatter-error", detail: "nested: array at 1" });
    }
  } finally {
    rmSync(file);
  }
});

// Without the check, the generated code would bind a literal after `either` by the ordinal of whichever branch it
// emitted last, printing the wrong source token where the other branch ran.
it("emit refuses a literal whose ordinal depends on which branch of `either` ran", () => {
  const ir = defineFormat<typeof jsonGrammar, JsonOptions>()({
    structure: { array: () => [either(parentIs("array"), "[", []), "["] },
  });
  expect(() => emit({ either: ir }, jsonGrammar as DslGrammar, "dsl.test.ts")).toThrow(/after an either/);
});
