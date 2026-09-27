// A spec's IR as TypeScript: per kind, one stream rule making the calls the two passes of `reference.ts` make,
// with the flattened sequence never built and each wrapping rule's choices decided while generating.
import type { Cond, DslGrammar, FormatIR, Tree, Wrap } from "./dsl.js";
import { holdsList } from "./reference.js";

const str = (s: string) => JSON.stringify(s);
/** The rule of `kind` as a local: `// A spec's IR as TypeScript: per kind, one stream rule making the calls the two passes of `reference.ts` make,
// with the flattened sequence never built and each wrapping rule's choices decided while generating.
import type { Cond, DslGrammar, FormatIR, Tree, Wrap } from "./dsl.js";
import { holdsList } from "./reference.js";

 keeps a kind named like a keyword (`if`, `class`) a valid name. */
const ident = (kind: string) => `$${kind.replace(/\W/g, "_")}`;

function optionKeys(ir: FormatIR): string[] {
  const keys = new Set<string>();
  const cond = (c: Cond | undefined) => {
    if (c !== undefined && typeof c !== "boolean") keys.add(c.key);
  };
  const walk = (x: Tree): void => {
    if (x.t === "seq") x.parts.forEach(walk);
    else if (x.t === "opt") walk(x.then);
    else if (x.t === "brackets") {
      cond(x.pad);
      walk(x.body);
    } else if (x.t === "sepBy") cond(x.trailing);
  };
  Object.values(ir.structure).forEach(walk);
  for (const w of Object.values(ir.wrapping)) cond(w.keepExpanded);
  return [...keys].sort();
}

function customNames(ir: FormatIR): string[] {
  const names = new Set<string>();
  const walk = (x: Tree): void => {
    if (x.t === "custom") names.add(x.name);
    else if (x.t === "seq") x.parts.forEach(walk);
    else if (x.t === "opt") walk(x.then);
    else if (x.t === "brackets") walk(x.body);
  };
  Object.values(ir.structure).forEach(walk);
  return [...names].sort();
}

const hasOpt = (x: Tree): boolean =>
  x.t === "opt" ||
  (x.t === "seq" && x.parts.some(hasOpt)) ||
  (x.t === "brackets" && hasOpt(x.body));

const cond = (c: Cond): string => {
  if (typeof c === "boolean") return String(c);
  const v = `ctx.options.${c.key}`;
  if (c.op === "truthy") return `Boolean(${v})`;
  return `${v} ${c.op === "is" ? "===" : "!=="} ${JSON.stringify(c.value)}`;
};

/** The body of one kind's rule. */
function emitRule(tree: Tree, w: Wrap, hasFields: boolean): string[] {
  const out: string[] = [];
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
  /** Child `c` with the comments attached to it, as the reference's leading, child and trailing entries. */
  const child = (c: string) => {
    line(`printLeadingComments(ctx, ${c});`);
    line(`ctx.printNode(${c});`);
    line(`printTrailingComments(ctx, ${c});`);
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
        return `(listItems(ctx, node, ${str(x.list.name)}, ${hasFields}).length === 0 && ctx.danglingComments(node).length === 0)`;
      case "ref":
        return `fieldChild(t, node, ${str(x.name)}) === -1`;
      case "opt": {
        const then = emptyExpr(x.then);
        const absent = `fieldChild(t, node, ${str(x.ref.name)}) === -1`;
        return then === "false" ? absent : `(${absent} || ${then})`;
      }
      case "seq": {
        const parts = x.parts.map(emptyExpr);
        if (parts.includes("false")) return "false";
        return parts.length === 0 ? "true" : `(${parts.join(" && ")})`;
      }
      case "tok":
      case "space":
      case "brackets":
      case "verbatim":
      case "custom":
        return "false";
      case "inOrder":
        throw new Error(`emit: a bracket idiom around \`${x.t}\` whose emptiness is not generated yet`);
    }
  };

  const list = (x: Extract<Tree, { t: "sepBy" }>, b: Extract<Tree, { t: "brackets" }>) => {
    const always = w.expand === "always";
    // Bound in the order the reference flattens them: the list between holds no literal.
    const openTok = bound(b.open);
    const closeTok = bound(b.close);
    const its = items(x);
    block(`if (${its}.length === 0)`, () => {
      line("const dangling = ctx.danglingComments(node);");
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
        `(${cond(w.keepExpanded)} && newlineBetween(t, firstLeaf(t, node), firstLeaf(t, first)))`,
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
    const trailing = x.trailing === false ? undefined : cond(x.trailing);
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
    const pad = b.pad === false ? "SOFT" : `${cond(b.pad)} ? 0 : SOFT`;
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
    line("close();");
    line("sLine(pad);");
    printBracket(closeTok, b.close);
    line("close();");
    depth--;
    line("}");
  };

  const walk = (x: Tree): void => {
    switch (x.t) {
      case "tok": {
        const c = bound(x.text);
        line(`if (${c} !== -1) sToken(${c}, t.text(${c}));`);
        return;
      }
      case "ref": {
        const c = name("c");
        line(`const ${c} = fieldChild(t, node, ${str(x.name)});`);
        block(`if (${c} !== -1)`, () => child(c));
        return;
      }
      case "opt":
        block(`if (fieldChild(t, node, ${str(x.ref.name)}) !== -1)`, () => walk(x.then));
        return;
      case "space":
        line('sText(" ");');
        return;
      case "seq":
        x.parts.forEach(walk);
        return;
      case "brackets": {
        if (x.body.t === "sepBy") return list(x.body, x);
        line(`open(GROUP, -1, ${w.expand === "always" ? "BROKEN" : "0"});`);
        bracket(x.open);
        const body = () => {
          line("open(INDENT);");
          line(`sLine(${x.pad === false ? "SOFT" : `${cond(x.pad)} ? 0 : SOFT`});`);
          walk(x.body);
          line("close();");
        };
        const empty = emptyExpr(x.body);
        if (empty === "false") body();
        else block(`if (!(${empty}))`, body);
        line(`sLine(${x.pad === false ? "SOFT" : `${cond(x.pad)} ? 0 : SOFT`});`);
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
        block(`if (${its}.length === 0)`, () => {
          line("for (const c of ctx.danglingComments(node)) ctx.comment(c);");
        });
        return;
      }
      case "lines": {
        const its = items(x);
        block(`for (let i = 0; i < ${its}.length; i++)`, () => {
          line("if (i > 0) sHardline();");
          line(`const item = ${its}[i] as number;`);
          child("item");
          if (w.blankLines !== undefined)
            line(`if (i < ${its}.length - 1 && nextLineEmpty(t, item)) sHardline();`);
        });
        block("for (const [i, c] of ctx.danglingComments(node).entries())", () => {
          line("if (i > 0) sHardline();");
          line("ctx.comment(c);");
        });
        return;
      }
      case "inOrder": {
        const its = name("items");
        const first = name("first");
        line(`const ${its} = new Set(ctx.items(node));`);
        if (x.space) line(`let ${first} = true;`);
        block("for (let i = 0, count = t.count(node); i < count; i++)", () => {
          line("const c = t.child(node, i);");
          line("const named = t.named(c);");
          line(`if (named && !${its}.has(c)) continue;`);
          if (x.space) {
            line(`if (!${first}) sText(" ");`);
            line(`${first} = false;`);
          }
          block("if (named)", () => child("c"), "} else sToken(c, t.text(c));");
        });
        return;
      }
      case "verbatim":
        line("sToken(node, t.text(node));");
        return;
      case "custom":
        line(`custom[${str(x.name)}](node, ctx);`);
        return;
    }
  };

  if (w.group) line("open(GROUP);");
  walk(tree);
  if (w.group) line("close();");
  const head = ["const t = ctx.tree;"];
  if (counters.length > 0) head.push(`let ${counters.map((_, i) => `n${i} = 0`).join(", ")};`);
  return [...head.map((s) => `  ${s}`), ...out];
}

/**
 * The module `fmt.gen.ts` of the specs `specs` (export name -> IR): per spec, a function taking the spec's
 * `custom` rules and returning its stream rules, typed by the options it reads.
 */
export function emit(
  specs: { readonly [name: string]: FormatIR },
  grammar: DslGrammar,
  origin: string,
): string {
  const parts: string[] = [
    `// Generated from ${origin} by src/fmt/dsl/generate.node.ts (\`pnpm generate\`); do not edit.`,
    "import {",
    "  BROKEN, close, FILL, FILL_ITEM, GROUP, IF_BROKEN, INDENT, open, SOFT, sHardline, sLine, sText, sToken,",
    '} from "../../fmt/stream.js";',
    "import {",
    "  endsLine, printLeadingComments, printTrailingComments, type StreamRule, type StreamRules,",
    '} from "../../fmt/stream-format.js";',
    'import { fieldChild, listItems, separators, tokenChild } from "../../fmt/dsl/runtime.js";',
    'import { newlineBetween, nextLineEmpty } from "../../fmt/text.js";',
    'import { firstLeaf } from "../../fmt/tree.js";',
  ];
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
        : `custom: { ${customs.map((c) => `readonly ${str(c)}: StreamRule<O>;`).join(" ")} }`;
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
  return `${parts.join("\n")}\n`;
}
