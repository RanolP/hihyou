// A spec's IR as TypeScript: per kind, one stream rule making the calls the two passes of `reference.ts` make,
// with the flattened sequence never built and each wrapping rule's choices decided while generating.
import {
  type Cond,
  type DslGrammar,
  type FormatIR,
  frameWrap,
  type Pairs,
  type Ref,
  type SplitLayout,
  type SplitOn,
  type Tree,
  type Wrap,
} from "./dsl.js";
import { type NormalizerName, normalizerOptions } from "./normalizers.js";
import { danglingOwner, holdsList } from "./reference.js";

const str = (s: string) => JSON.stringify(s);
/** The rule of `kind` as a local: `$` keeps a kind named like a keyword (`if`, `class`) a valid name. */
const ident = (kind: string) => `$${kind.replace(/\W/g, "_")}`;

/** Calls `visit` on every condition `ir` holds. */
function eachCond(ir: FormatIR, visit: (c: Cond) => void): void {
  const cond = (c: Cond | undefined): void => {
    if (c === undefined) return;
    visit(c);
    if (typeof c === "boolean") return;
    if (c.t === "not") cond(c.c);
    else if (c.t === "all" || c.t === "any") c.cs.forEach(cond);
  };
  const walk = (x: Tree): void => {
    if (x.t === "text" || x.t === "bail") cond(x.when);
    else if (x.t === "seq") x.parts.forEach(walk);
    else if (x.t === "opt") walk(x.then);
    else if (x.t === "tokIf") {
      cond(x.synth);
      walk(x.then);
    } else if (x.t === "brackets") {
      cond(x.pad);
      walk(x.body);
    } else if (x.t === "sepBy") cond(x.trailing);
    else if (x.t === "inOrder") {
      cond(x.tight?.when);
      cond(x.spaceWhen?.when);
    } else if (x.t === "splitOn") {
      cond(x.wrapItem);
      if (x.item.t === "words") cond(x.item.keepLines);
      const layout = (l: SplitLayout): void => {
        if ("when" in l) {
          cond(l.when);
          layout(l.then);
          layout(l.else);
        }
      };
      layout(x.layout);
    }
  };
  Object.values(ir.structure).forEach(walk);
  for (const w of Object.values(ir.wrapping)) {
    cond(w.keepExpanded);
    for (const f of Object.values(w.frames ?? {})) cond(f.keepExpanded);
  }
}

function optionKeys(ir: FormatIR): string[] {
  const keys = new Set<string>();
  eachCond(ir, (c) => {
    if (typeof c !== "boolean" && c.t === "option") keys.add(c.key);
  });
  // A `text` rule's normalizer reads its options too (a `text` is only ever a whole rule).
  for (const x of Object.values(ir.structure))
    if (x.t === "text") for (const k of normalizerOptions[x.fn] ?? []) keys.add(k);
  return [...keys].sort();
}

type RuleType = "CustomRule" | "TokenRule" | "FrameRule" | "PredicateRule";

/**
 * The custom rules `ir` names, each as the rule type it takes: a node's (`CustomRule`), a token's (`TokenRule`),
 * a bracket frame's (`FrameRule`) or a `when` condition's (`PredicateRule`).
 */
function customNames(ir: FormatIR): [string, RuleType][] {
  const names = new Map<string, RuleType>();
  const add = (name: string, type: RuleType) => {
    const had = names.get(name) ?? type;
    if (had !== type) throw new Error(`emit: custom rule ${name} is both a ${had} and a ${type}`);
    names.set(name, type);
  };
  const walk = (x: Tree): void => {
    if (x.t === "custom") add(x.name, "CustomRule");
    else if (x.t === "ref" && x.via !== undefined) add(x.via, "CustomRule");
    else if (x.t === "tok" && x.via !== undefined) add(x.via, "TokenRule");
    else if (x.t === "seq") x.parts.forEach(walk);
    else if (x.t === "opt" || x.t === "tokIf") walk(x.then);
    else if (x.t === "brackets") {
      if (x.via !== undefined) add(x.via, "FrameRule");
      walk(x.body);
    }
  };
  Object.values(ir.structure).forEach(walk);
  eachCond(ir, (c) => {
    if (typeof c !== "boolean" && c.t === "rule") add(c.name, "PredicateRule");
  });
  return [...names].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Whether `x` binds a source token by its spelling: a literal, or a bracket idiom's brackets. */
const bindsToken = (x: Tree): boolean =>
  x.t === "tok" ||
  x.t === "tokIf" ||
  x.t === "brackets" ||
  (x.t === "seq" && x.parts.some(bindsToken)) ||
  (x.t === "opt" && bindsToken(x.then));

/** Whether some literal of `x` may go unprinted: under an `opt`, or beside a token in its `andThen`. */
const hasOpt = (x: Tree): boolean =>
  x.t === "opt" ||
  (x.t === "tokIf" && bindsToken(x.then)) ||
  (x.t === "seq" && x.parts.some(hasOpt)) ||
  (x.t === "brackets" && hasOpt(x.body));

/** An expression true when the string `expr` is one of `kinds`, compared inline rather than through an array. */
const oneOf = (expr: string, kinds: readonly string[]) =>
  kinds.length === 1 ? `${expr} === ${str(kinds[0] as string)}` : `(${kinds.map((k) => `${expr} === ${str(k)}`).join(" || ")})`;

/**
 * `c` as an expression over the rule's `t`, `node` and `ctx`; `hasFields`: whether the node's kind has fields.
 * `self` names the node asked about in place of `node` (a `splitOn` item), and `run` the `splitOn` run in scope.
 */
const cond = (c: Cond, hasFields: boolean, self = "node", run?: string): string => {
  if (typeof c === "boolean") return String(c);
  switch (c.t) {
    case "parent":
      return `parentIs(t, ${self}, ${str(c.kind)})`;
    case "rule":
      return `custom[${str(c.name)}](${self}, ctx)`;
    case "field":
      return `t.fieldName(${self}) === ${str(c.name)}`;
    case "has":
      // An item's kind, and so whether it has fields, is known only at run time.
      if (self !== "node") throw new Error("emit: a `has` condition on a splitOn item");
      return c.kind === undefined && c.name !== "children"
        ? `fieldChild(t, node, ${str(c.name)}) !== -1`
        : `hasChild(ctx, node, ${str(c.name)}, ${c.kind === undefined ? "undefined" : str(c.kind)}, ${hasFields})`;
    case "entryCount":
    case "anyEntry": {
      if (run === undefined || self !== "node") throw new Error(`emit: a ${c.t} condition outside a splitOn's run`);
      return c.t === "entryCount"
        ? `${run}.entries.length === ${c.n}`
        : `someEntry(t, ${run}.entries, ${c.many}, ${JSON.stringify(c.startsWith)})`;
    }
    case "not":
      return `!(${cond(c.c, hasFields, self, run)})`;
    case "all":
    case "any":
      return c.cs.length === 0
        ? String(c.t === "all")
        : `(${c.cs.map((x) => cond(x, hasFields, self, run)).join(c.t === "all" ? " && " : " || ")})`;
    case "option": {
      const v = `ctx.options.${c.key}`;
      if (c.op === "truthy") return `Boolean(${v})`;
      return `${v} ${c.op === "is" ? "===" : "!=="} ${JSON.stringify(c.value)}`;
    }
  }
};

/** The body of one kind's rule. */
function emitRule(tree: Tree, rule: Wrap, hasFields: boolean): string[] {
  const out: string[] = [];
  const when = (c: Cond) => cond(c, hasFields);
  let depth = 1;
  let fresh = 0;
  const line = (s: string) => out.push(`${"  ".repeat(depth)}${s}`);
  const block = (head: string, body: () => void, tail = "}") => {
    line(`${head} {`);
    depth++;
    body();
    depth--;
    line(tail);
  };
  const name = (base: string) => `${base}${fresh++}`;
  /** The list idiom that prints the node's dangling comments. */
  const owner = danglingOwner(tree);

  // The k-th literal spelled t binds to the k-th anonymous child spelled t: fixed ordinals unless an `opt` may
  // skip some, and then counters that only the literals actually printed advance.
  const dynamic = hasOpt(tree);
  const ordinals = new Map<string, number>();
  const counters: string[] = [];
  const ordinal = (text: string) => {
    if (!dynamic) {
      const nth = ordinals.get(text) ?? 0;
      ordinals.set(text, nth + 1);
      return String(nth);
    }
    let i = counters.indexOf(text);
    if (i === -1) i = counters.push(text) - 1;
    return `n${i}++`;
  };
  const bound = (text: string) => {
    const c = name("c");
    line(`const ${c} = tokenChild(t, node, ${str(text)}, ${ordinal(text)});`);
    return c;
  };
  /** Bracket token `c` spelled `text`, synthetic where the source has none. */
  const printBracket = (c: string, text: string) => {
    line(`if (${c} === -1) sToken(node, ${str(text)}, true);`);
    line(`else sToken(${c}, t.text(${c}));`);
  };
  const bracket = (text: string) => printBracket(bound(text), text);
  /**
   * The child a ref names, -1 when absent: the `at`th of the list (or of its `split`
   * stretches), a field's, or the first child in no field.
   */
  const refChild = ({ name, at, split }: Ref) =>
    split !== undefined
      ? `splitChild(ctx, node, ${str(name)}, ${str(split)}, ${at ?? 0}, ${hasFields})`
      : at !== undefined || name === "children"
        ? `(listItems(ctx, node, ${str(name)}, ${hasFields})[${at ?? 0}] ?? -1)`
        : `fieldChild(t, node, ${str(name)})`;
  /** Child `c` with the comments attached to it, as the reference's leading, child and trailing entries. */
  const child = (c: string, via?: string) => {
    // Through `ctx.print`, which leaves the comments to a node that prints its own (`printsOwnComments`).
    if (via === undefined) {
      line(`ctx.print(${c});`);
      return;
    }
    line(`printKid(ctx, ${c}, () => {`);
    line(`  if (ctx.isBroken(${c})) ctx.printNode(${c});`);
    line(`  else custom[${str(via)}](${c}, ctx);`);
    line(`});`);
  };
  const items = (x: Extract<Tree, { t: "sepBy" | "lines" }>) => {
    const v = name("items");
    line(`const ${v} = listItems(ctx, node, ${str(x.list.name)}, ${hasFields});`);
    return v;
  };

  /** An expression true when `x` flattens to no entries at all, as the reference's empty bracket body; "false" when it never does. */
  const emptyExpr = (x: Tree): string => {
    switch (x.t) {
      case "sepBy":
      case "lines":
        return `(listItems(ctx, node, ${str(x.list.name)}, ${hasFields}).length === 0${x === owner ? " && ctx.danglingComments(node).length === 0" : ""})`;
      case "ref":
        return `${refChild(x)} === -1`;
      case "opt": {
        const then = emptyExpr(x.then);
        const absent = `${refChild(x.ref)} === -1`;
        return then === "false" ? absent : `(${absent} || ${then})`;
      }
      case "seq": {
        const parts = x.parts.map(emptyExpr);
        if (parts.includes("false")) return "false";
        return parts.length === 0 ? "true" : `(${parts.join(" && ")})`;
      }
      case "tokIf":
      case "self":
      case "bail":
        throw new Error(`emit: a bracket idiom around \`${x.t}\` whose emptiness is not generated yet`);
      case "tok":
      case "space":
      case "brackets":
      case "verbatim":
      case "text":
      case "custom":
        return "false";
      case "inOrder":
        throw new Error(`emit: a bracket idiom around \`${x.t}\` whose emptiness is not generated yet`);
      case "splitOn": {
        const run = splitRun(x);
        return `(${run}.entries.length === 0 && ${run}.trail.length === 0)`;
      }
    }
  };

  /** The variable holding `x`'s run, computed at its first use: a bracket body's emptiness, or its printing. */
  const runs = new Map<SplitOn, string>();
  const splitRun = (x: SplitOn) => {
    let run = runs.get(x);
    if (run === undefined) {
      run = name("run");
      runs.set(x, run);
      line(
        `const ${run} = splitRun(ctx, node, ${str(x.sep)}, ${JSON.stringify(x.except)}, ${JSON.stringify(x.trail)});`,
      );
    }
    return run;
  };
  /** A `splitOn`: a local printing one entry, then per layout its conditions chose, the entries it places. */
  const split = (x: SplitOn) => {
    const run = splitRun(x);
    const printItem = name("item");
    block(`const ${printItem} = (c: number) =>`, () => {
      line("if (!t.named(c)) sToken(c, t.text(c));");
      if (x.wrapItem === false) line("else ctx.print(c);");
      else
        block(`else if (${cond(x.wrapItem, false, "c")})`, () => {
          line("open(GROUP);");
          line("open(INDENT);");
          line("ctx.print(c);");
          line("close();");
          line("close();");
        }, "} else ctx.print(c);");
    }, "};");
    const printEntry = name("entry");
    const keep = x.item.t === "words" && x.item.keepLines !== false ? name("keep") : undefined;
    if (keep !== undefined && x.item.t === "words")
      line(`const ${keep} = ${cond(x.item.keepLines, hasFields, "node", run)};`);
    block(`const ${printEntry} = (e: SplitEntry) =>`, () => {
      line("const items = e.items;");
      if (x.item.t === "adjacent") line(`for (const c of items) ${printItem}(c);`);
      else if (x.item.t === "space")
        block("for (let i = 0; i < items.length; i++)", () => {
          line('if (i > 0) sText(" ");');
          line(`${printItem}(items[i] as number);`);
        });
      else {
        line(`if (items.length === 1) ${printItem}(items[0] as number);`);
        block("else if (items.length > 1)", () => {
          if (keep !== undefined)
            line(
              `const grid = ${keep} && items.some((c, i) => i > 0 && breaksBetween(t, items[i - 1] as number, c));`,
            );
          line("open(GROUP);");
          line("open(INDENT);");
          line("open(FILL);");
          if (keep !== undefined)
            block("if (grid)", () => {
              line("open(FILL_ITEM);");
              line("close();");
              line("sHardline();");
            });
          line("open(FILL_ITEM);");
          line(`${printItem}(items[0] as number);`);
          block("for (let i = 1; i < items.length; i++)", () => {
            line("const prev = items[i - 1] as number;");
            line("const c = items[i] as number;");
            line(`if (t.adjoins(prev, c)) ${printItem}(c);`);
            if (keep !== undefined)
              block("else if (grid && !breaksBetween(t, prev, c))", () => {
                line('sText(" ");');
                line(`${printItem}(c);`);
              });
            block("else", () => {
              line("close();");
              line(keep !== undefined ? "if (grid) sHardline();" : "sLine(0);");
              if (keep !== undefined) line("else sLine(0);");
              line("open(FILL_ITEM);");
              line(`${printItem}(c);`);
            });
          });
          for (let k = 0; k < 4; k++) line("close();");
        });
      }
      line("if (e.sep !== -1) sToken(e.sep, t.text(e.sep));");
    }, "};");
    const place = (l: SplitLayout): void => {
      if ("when" in l) {
        block(`if (${cond(l.when, hasFields, "node", run)})`, () => place(l.then), "} else {");
        depth++;
        place(l.else);
        depth--;
        line("}");
        return;
      }
      if (l.group) line("open(GROUP);");
      if (l.indent) line("open(INDENT);");
      if (l.first === "soft") line("sLine(SOFT);");
      else if (l.first === "hard") line("sHardline();");
      if (l.fill) line("open(FILL);");
      block(`for (let i = 0; i < ${run}.entries.length; i++)`, () => {
        if (l.between === "line") line("if (i > 0) sLine(0);");
        else if (l.between === "hardline") line("if (i > 0) sHardline();");
        if (l.fill) line("open(FILL_ITEM);");
        line(`${printEntry}(${run}.entries[i] as SplitEntry);`);
        if (l.fill) line("close();");
      });
      if (l.fill) line("close();");
      if (l.indent) line("close();");
      if (l.group) line("close();");
    };
    block(`if (${run}.entries.length > 0)`, () => place(x.layout));
    block(`for (const c of ${run}.trail)`, () => {
      line('sText(" ");');
      line("ctx.print(c);");
    });
  };

  const list = (x: Extract<Tree, { t: "sepBy" }>, b: Extract<Tree, { t: "brackets" }>) => {
    const w = frameWrap(rule, b.label);
    const always = w.expand === "always";
    // Bound in the order the reference flattens them: the list between holds no literal.
    const openTok = bound(b.open);
    const closeTok = bound(b.close);
    const its = items(x);
    block(`if (${its}.length === 0)`, () => {
      line(`const dangling = ${x === owner ? "ctx.danglingComments(node)" : "[] as number[]"};`);
      line("open(GROUP);");
      printBracket(openTok, b.open);
      block("if (dangling.length > 0)", () => {
        line("open(INDENT);");
        line("sLine(SOFT);");
        block("for (let i = 0; i < dangling.length; i++)", () => {
          line("if (i > 0) sHardline();");
          line("ctx.comment(dangling[i] as number);");
        });
        line("close();");
        line("if (dangling.some((c) => ctx.isLineComment(c))) sHardline();");
        line("else sLine(SOFT);");
      });
      printBracket(closeTok, b.close);
      line("close();");
    }, "} else {");
    depth++;
    line(`const first = ${its}[0] as number;`);
    line(`const last = ${its}.length - 1;`);
    line(`const seps = separators(t, node, ${its}, ${str(x.sep)});`);
    const breaks: string[] = [];
    if (always) breaks.push("true");
    if (w.keepExpanded !== undefined && w.keepExpanded !== false)
      breaks.push(
        `(${when(w.keepExpanded)} && newlineBetween(t, firstLeaf(t, node), firstLeaf(t, first)))`,
      );
    if (w.breakMatrix)
      breaks.push(
        `(${its}.length > 1 && ${its}.every((item, i) => { const next = ${its}[i + 1]; return ctx.isList(item) && (next === undefined || t.kindName(next) === t.kindName(item)) && ctx.items(item).length > 1; }))`,
      );
    const fills = !always && (w.packWhenAllOf?.length ?? 0) > 0;
    if (fills)
      line(
        `const concise = ${its}.length > 1 && ${its}.every((item) => ${JSON.stringify(w.packWhenAllOf)}.includes(t.kindName(item)) && !ctx.trailingComments(item).some((c) => endsLine(ctx, item, c)));`,
      );
    line(
      `const listGroup = open(GROUP, -1, ${breaks.length === 0 ? "0" : `${breaks.join(" || ")} ? BROKEN : 0`});`,
    );
    const trailing = x.trailing === false ? undefined : when(x.trailing);
    const slot = (i: string) => {
      block(`if (${i} < last)`, () => {
        line(`const s = seps[${i}] as number;`);
        line("if (s !== -1) sToken(s, t.text(s));");
      }, trailing === undefined ? "}" : `} else if (${trailing}) {`);
      if (trailing !== undefined) {
        depth++;
        line(`open(IF_BROKEN, ${fills ? "concise ? listGroup : -1" : "-1"});`);
        line(`sToken(${its}[last] as number, ${str(x.sep)}, true);`);
        line("close();");
        depth--;
        line("}");
      }
    };
    const pad = b.pad === false ? "SOFT" : `${when(b.pad)} ? 0 : SOFT`;
    line(`const pad = ${pad};`);
    printBracket(openTok, b.open);
    line("open(INDENT);");
    line("sLine(pad);");
    const blank = (item: string) => (always ? "false" : `nextLineEmpty(t, ${item})`);
    const plain = () =>
      block(`for (let i = 0; i < ${its}.length; i++)`, () => {
        line(`const item = ${its}[i] as number;`);
        if (w.itemsAsGroups) line("open(GROUP);");
        child("item");
        if (w.itemsAsGroups) line("close();");
        slot("i");
        line("if (i === last) break;");
        line("sLine(0);");
        if (!always)
          line(
            `if (${blank("item")}) ${w.blankLines === "force" ? "sHardline();" : "sLine(SOFT);"}`,
          );
      });
    if (fills) {
      block("if (concise)", () => {
        line("open(FILL);");
        block(`for (let i = 0; i < ${its}.length; i++)`, () => {
          line(`const item = ${its}[i] as number;`);
          line("open(FILL_ITEM);");
          child("item");
          slot("i");
          line("close();");
          line("if (i === last) break;");
          block(`if (${blank("item")})`, () => {
            line("sHardline();");
            line("sHardline();");
          }, `} else if (ctx.leadingComments(${its}[i + 1] as number).some((c) => ctx.isLineComment(c))) sHardline();`);
          line("else sLine(0);");
        });
        line("close();");
      }, "} else {");
      depth++;
      plain();
      depth--;
      line("}");
    } else plain();
    // Dangling comments after the items, each on a line of its own once the list breaks; a line comment breaks it.
    if (x === owner)
      block("for (const c of ctx.danglingComments(node))", () => {
        line("sLine(0);");
        line("ctx.comment(c);");
        line("if (ctx.isLineComment(c)) sBreakParent();");
      });
    line("close();");
    line("sLine(pad);");
    printBracket(closeTok, b.close);
    line("close();");
    depth--;
    line("}");
  };

  /**
   * A `.via` bracket frame: both brackets bound before the rule runs, which is where the reference binds them as
   * long as the body binds no token by its spelling, so the rule's calls, in any order or none, never shift which
   * source token a later literal binds to.
   */
  const frame = (x: Extract<Tree, { t: "brackets" }>, via: string) => {
    if (x.pad !== false) throw new Error(`emit: the frame printed by ${via} takes no pad`);
    if (bindsToken(x.body))
      throw new Error(`emit: the body of the frame printed by ${via} binds a token by its spelling`);
    const openTok = bound(x.open);
    const closeTok = bound(x.close);
    line(`custom[${str(via)}](node, ctx, {`);
    depth++;
    block("open: () =>", () => printBracket(openTok, x.open), "},");
    block("body: () =>", () => walk(x.body), "},");
    block("close: () =>", () => printBracket(closeTok, x.close), "},");
    depth--;
    line("});");
  };

  /** Prints the token of the innermost `tokIf` being walked (its `self`). */
  let self: (() => void) | undefined;
  const walk = (x: Tree): void => {
    switch (x.t) {
      case "tok": {
        const c = bound(x.text);
        if (x.via === undefined) line(`if (${c} !== -1) sToken(${c}, t.text(${c}));`);
        else line(`custom[${str(x.via)}](${c} === -1 ? undefined : ${c}, node, ctx);`);
        return;
      }
      case "tokIf": {
        const c = bound(x.text);
        const outer = self;
        if (x.synth === undefined) {
          self = () => line(`sToken(${c}, t.text(${c}));`);
          block(`if (${c} !== -1)`, () => walk(x.then));
        } else {
          // A zero-width source token (an inserted `;`) counts as none.
          const p = name("p");
          line(`const ${p} = ${c} !== -1 && t.text(${c}) !== "";`);
          self = () => {
            line(`if (${p}) sToken(${c}, t.text(${c}));`);
            line(`else sToken(node, ${str(x.text)}, true);`);
          };
          block(`if (${when(x.synth)})`, () => walk(x.then), `} else if (${p}) sToken(${c}, "");`);
        }
        self = outer;
        return;
      }
      case "self":
        if (!self) throw new Error("emit: `self` outside a token's `andThen`");
        self();
        return;
      case "bail": {
        const raise = `throw new Bail(t, node, ${str(x.reason)});`;
        line(x.when === true ? raise : `if (${when(x.when)}) ${raise}`);
        return;
      }
      case "ref": {
        const c = name("c");
        line(`const ${c} = ${refChild(x)};`);
        block(`if (${c} !== -1)`, () => child(c, x.via));
        return;
      }
      case "opt":
        block(`if (${refChild(x.ref)} !== -1)`, () => walk(x.then));
        return;
      case "space":
        line('sText(" ");');
        return;
      case "seq":
        x.parts.forEach(walk);
        return;
      case "brackets": {
        if (x.via !== undefined) return frame(x, x.via);
        if (x.body.t === "sepBy") return list(x.body, x);
        line(`open(GROUP, -1, ${frameWrap(rule, x.label).expand === "always" ? "BROKEN" : "0"});`);
        bracket(x.open);
        const body = () => {
          line("open(INDENT);");
          line(`sLine(${x.pad === false ? "SOFT" : `${when(x.pad)} ? 0 : SOFT`});`);
          walk(x.body);
          line("close();");
        };
        const empty = emptyExpr(x.body);
        if (empty === "false") body();
        else block(`if (!(${empty}))`, body);
        line(`sLine(${x.pad === false ? "SOFT" : `${when(x.pad)} ? 0 : SOFT`});`);
        bracket(x.close);
        line("close();");
        return;
      }
      case "sepBy": {
        const its = items(x);
        line(`const seps = separators(t, node, ${its}, ${str(x.sep)});`);
        block(`for (let i = 0; i < ${its}.length; i++)`, () => {
          line(`const item = ${its}[i] as number;`);
          child("item");
          block(`if (i < ${its}.length - 1)`, () => {
            line("const s = seps[i] as number;");
            line("if (s !== -1) sToken(s, t.text(s));");
            line("sLine(0);");
          });
        });
        if (x === owner) line("for (const c of ctx.danglingComments(node)) ctx.comment(c);");
        return;
      }
      case "lines": {
        const its = items(x);
        block(`for (let i = 0; i < ${its}.length; i++)`, () => {
          line("if (i > 0) sHardline();");
          line(`const item = ${its}[i] as number;`);
          child("item");
          if (frameWrap(rule, x.list.name).blankLines !== undefined)
            line(`if (i < ${its}.length - 1 && nextLineEmpty(t, item)) sHardline();`);
        });
        if (x === owner)
          block("for (const [i, c] of ctx.danglingComments(node).entries())", () => {
            line("if (i > 0) sHardline();");
            line("ctx.comment(c);");
          });
        return;
      }
      case "inOrder": {
        const its = name("items");
        line(`const ${its} = new Set(ctx.items(node));`);
        if (!x.tight && !x.spaceWhen && !x.verbatim && (x.join === "none" || x.join === "space")) {
          const space = x.join === "space";
          const first = name("first");
          if (space) line(`let ${first} = true;`);
          block("for (let i = 0, count = t.count(node); i < count; i++)", () => {
            line("const c = t.child(node, i);");
            line("const named = t.named(c);");
            line(`if (named && !${its}.has(c)) continue;`);
            if (space) {
              line(`if (!${first}) sText(" ");`);
              line(`${first} = false;`);
            }
            block("if (named)", () => child("c"), "} else sToken(c, t.text(c));");
          });
          return;
        }
        // Which (prev, c) pairs a spacing rule claims: its `when` decided once per node, its kinds per pair.
        const pairs = (p: Pairs | undefined): string | undefined => {
          if (p === undefined) return undefined;
          const tests: string[] = [];
          if (p.when !== undefined) {
            const all = name("all");
            line(`const ${all} = ${when(p.when)};`);
            tests.push(all);
          }
          if (p.after?.length) tests.push(oneOf("t.kindName(prev)", p.after));
          if (p.before?.length) tests.push(oneOf("t.kindName(c)", p.before));
          return tests.length === 0 ? undefined : tests.join(" || ");
        };
        const tight = pairs(x.tight);
        const spaced = pairs(x.spaceWhen);
        const join =
          x.join === "space"
            ? 'sText(" ");'
            : x.join === "gap"
              ? 'if (!t.adjoins(prev, c)) sText(" ");'
              : x.join === "line"
                ? "sLine(0);"
                : undefined;
        const steps: [string, string][] = [];
        if (tight !== undefined) steps.push([tight, "{}"]);
        if (spaced !== undefined) steps.push([spaced, 'sText(" ");']);
        const spacing = steps.length > 0 || join !== undefined;
        if (spacing) line("let prev = -1;");
        block("for (let i = 0, count = t.count(node); i < count; i++)", () => {
          line("const c = t.child(node, i);");
          line("const named = t.named(c);");
          line(`if (named && !${its}.has(c)) continue;`);
          if (spacing) {
            block("if (prev !== -1)", () => {
              steps.forEach(([test, then], k) => line(`${k === 0 ? "if" : "else if"} (${test}) ${then}`));
              if (join !== undefined) line(steps.length === 0 ? join : `else ${join}`);
            });
            line("prev = c;");
          }
          const printNamed = () => {
            const v = x.verbatim;
            if (v === undefined) return child("c");
            const verbatim = () => {
              line("const comments = !ctx.ownsComments(c);");
              line("if (comments) printLeadingComments(ctx, c);");
              line("sToken(c, t.text(c));");
              line("if (comments) printTrailingComments(ctx, c);");
            };
            if (v.except.length === 0) return verbatim();
            block(`if (${oneOf("t.kindName(c)", v.except)})`, () => child("c"), "} else {");
            depth++;
            verbatim();
            depth--;
            line("}");
          };
          block("if (named)", printNamed, "} else sToken(c, t.text(c));");
        });
        return;
      }
      case "verbatim":
        line("sToken(node, t.text(node));");
        return;
      case "text": {
        const call = (s: string) => `${x.fn}(${s}${normalizerOptions[x.fn] ? ", ctx.options" : ""})`;
        if (x.when === true) {
          line(`sToken(node, ${call("t.text(node)")});`);
          return;
        }
        const raw = name("raw");
        line(`const ${raw} = t.text(node);`);
        line(`sToken(node, ${when(x.when)} ? ${call(raw)} : ${raw});`);
        return;
      }
      case "custom":
        line(`custom[${str(x.name)}](node, ctx);`);
        return;
      case "splitOn":
        split(x);
        return;
    }
  };

  if (rule.group) line("open(GROUP);");
  walk(tree);
  if (rule.group) line("close();");
  const head = ["const t = ctx.tree;"];
  if (counters.length > 0) head.push(`let ${counters.map((_, i) => `n${i} = 0`).join(", ")};`);
  return [...head.map((s) => `  ${s}`), ...out];
}

/**
 * The module `fmt.gen.ts` of the specs `specs` (export name -> IR): per spec, a function taking the spec's
 * `custom` rules and returning its stream rules, typed by the options it reads. The rules write through `sink`,
 * a module with the stream's writing functions (by default the stream itself).
 */
export function emit(
  specs: { readonly [name: string]: FormatIR },
  grammar: DslGrammar,
  origin: string,
  sink = "../../fmt/stream.js",
): string {
  const parts: string[] = [
    `// Generated from ${origin} by src/fmt/dsl/generate.node.ts (\`pnpm generate\`); do not edit.`,
    "import {",
    "  BROKEN, close, FILL, FILL_ITEM, GROUP, IF_BROKEN, INDENT, open, SOFT, sBreakParent, sHardline, sLine, sText, sToken,",
    `} from ${str(sink)};`,
    "import {",
    "  endsLine, printLeadingComments, printTrailingComments, type StreamRule, type StreamRules,",
    '} from "../../fmt/stream-format.js";',
    'import {',
    '  type CustomRule, fieldChild, listItems, printKid, separators, tokenChild,',
    '} from "../../fmt/dsl/runtime.js";',
    'import { newlineBetween, nextLineEmpty } from "../../fmt/text.js";',
    'import { firstLeaf } from "../../fmt/tree.js";',
  ];
  // Only a spec with a `tok(text).via` imports TokenRule, and one with a frame's `.via` FrameRule, so the other
  // specs' output stays as it was.
  let tokenRules = false;
  let frameRules = false;
  let predicateRules = false;
  for (const [spec, ir] of Object.entries(specs)) {
    const keys = optionKeys(ir);
    const customs = customNames(ir);
    const options =
      keys.length === 0
        ? "unknown"
        : `{ ${keys.map((k) => `readonly ${k}: unknown;`).join(" ")} }`;
    const param =
      customs.length === 0
        ? ""
        : `custom: { ${customs.map(([c, type]) => `readonly ${str(c)}: ${type}<O>;`).join(" ")} }`;
    if (customs.some(([, type]) => type === "TokenRule")) tokenRules = true;
    if (customs.some(([, type]) => type === "FrameRule")) frameRules = true;
    if (customs.some(([, type]) => type === "PredicateRule")) predicateRules = true;
    parts.push("", `export function ${spec}<O extends ${options}>(${param}): StreamRules<O> {`);
    const kinds = Object.keys(ir.structure);
    for (const kind of kinds) {
      const tree = ir.structure[kind] as Tree;
      const body = emitRule(tree, ir.wrapping[kind] ?? {}, kind in grammar.fieldTypes);
      parts.push(`  const ${ident(kind)}: StreamRule<O> = (node, ctx) => {`);
      parts.push(...body.map((l) => `  ${l}`));
      parts.push("  };");
    }
    const lists = kinds.filter((k) => holdsList(ir.structure[k] as Tree));
    parts.push(
      "  return {",
      `    rules: new Map<string, StreamRule<O>>([${kinds.map((k) => `[${str(k)}, ${ident(k)}]`).join(", ")}]),`,
      `    lists: new Set<StreamRule<O>>([${lists.map(ident).join(", ")}]),`,
      "  };",
      "}",
    );
  }
  // Likewise only a spec with a `.split` imports splitChild.
  if (parts.some((p) => p.includes("splitChild(")))
    parts.splice(
      parts.indexOf('} from "../../fmt/dsl/runtime.js";') + 1,
      0,
      'import { splitChild } from "../../fmt/dsl/runtime.js";',
    );
  if (parts.some((p) => p.includes("hasChild(")))
    parts.splice(
      parts.indexOf('} from "../../fmt/dsl/runtime.js";') + 1,
      0,
      'import { hasChild } from "../../fmt/dsl/runtime.js";',
    );
  if (parts.some((p) => p.includes("parentIs(")))
    parts.splice(
      parts.indexOf('} from "../../fmt/dsl/runtime.js";') + 1,
      0,
      'import { parentIs } from "../../fmt/dsl/runtime.js";',
    );
  if (parts.some((p) => p.includes("splitRun(")))
    parts.splice(
      parts.indexOf('} from "../../fmt/dsl/runtime.js";') + 1,
      0,
      `import { ${["breaksBetween", "someEntry"].filter((f) => parts.some((p) => p.includes(`${f}(`))).map((f) => `${f}, `).join("")}type SplitEntry, splitRun } from "../../fmt/dsl/runtime.js";`,
    );
  if (parts.some((p) => p.includes("new Bail(")))
    parts.splice(
      parts.indexOf('} from "../../fmt/dsl/runtime.js";') + 1,
      0,
      'import { Bail } from "../../fmt/dsl/runtime.js";',
    );
  // The normalizers the `text` rules name, each called directly (a `text` is only ever a whole rule).
  const fns = new Set<NormalizerName>();
  for (const ir of Object.values(specs))
    for (const x of Object.values(ir.structure)) if (x.t === "text") fns.add(x.fn);
  if (fns.size > 0)
    parts.splice(
      parts.indexOf('} from "../../fmt/dsl/runtime.js";') + 1,
      0,
      `import { ${[...fns].sort().join(", ")} } from "../../fmt/dsl/normalizers.js";`,
    );
  const extra = [
    ...(tokenRules ? ["TokenRule"] : []),
    ...(frameRules ? ["FrameRule"] : []),
    ...(predicateRules ? ["PredicateRule"] : []),
  ];
  if (extra.length > 0)
    parts.splice(
      parts.indexOf('} from "../../fmt/dsl/runtime.js";') + 1,
      0,
      `import type { ${extra.join(", ")} } from "../../fmt/dsl/runtime.js";`,
    );
  return `${parts.join("\n")}\n`;
}
