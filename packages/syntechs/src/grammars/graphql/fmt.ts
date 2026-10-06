// GraphQL as prettier 3.9.9's printer lays it out (language-graphql/printer-graphql.js and print/), over
// tree-sitter-graphql's tree. The grammar's wrapper nodes (`definition`, `selection`, `value`, `type`, ...) print
// their one child; each rule below is the printer case of the graphql-js node it stands for.

import { NO_NODE } from "../../core/arena.js";
import type { Normalize } from "../../fmt/check.js";
import type { CommentHandler } from "../../fmt/comments.js";
import { type PrettierOptions, prettierDefaults, prettierSettings } from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import {
  close,
  GROUP,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  open,
  SOFT,
  sHardline,
  sLine,
  sText,
  sToken,
} from "../../fmt/stream.js";
import type { StreamCtx, StreamRule } from "../../fmt/stream-format.js";
import { nextLineEmpty } from "../../fmt/text.js";
import { grammar } from "./bundle.js";
import { language } from "./index.js";

/** The prettier options its GraphQL printer reads: `bracketSpacing`, in an object value. */
export type GraphqlOptions = PrettierOptions;

const defaults: GraphqlOptions = { ...prettierDefaults };

type Ctx = StreamCtx<GraphqlOptions>;

const kind = (ctx: Ctx, n: number) => ctx.tree.kindName(n);
/** `n`'s code children: named, no comment, no comma. */
const items = (ctx: Ctx, n: number) => ctx.items(n);
const first = (ctx: Ctx, n: number, k: string) => items(ctx, n).find((c) => kind(ctx, c) === k);
const all = (ctx: Ctx, n: number, k: string) => items(ctx, n).filter((c) => kind(ctx, c) === k);
/** Whether `n` has the anonymous token `text` among its children. */
const hasToken = (ctx: Ctx, n: number, text: string) => {
  for (let i = 0; i < ctx.tree.count(n); i++) {
    const c = ctx.tree.child(n, i);
    if (!ctx.tree.named(c) && ctx.tree.text(c) === text) return true;
  }
  return false;
};
const print = (ctx: Ctx, n: number | undefined) => {
  if (n !== undefined) ctx.print(n);
};

/** printSequence: `nodes` one per line, a blank line kept after one the source has a blank line after. */
function sequence(ctx: Ctx, nodes: readonly number[]): void {
  nodes.forEach((n, i) => {
    if (i > 0) sHardline();
    ctx.print(n);
    if (i < nodes.length - 1 && nextLineEmpty(ctx.tree, n)) sHardline();
  });
}

/** `(a, b)` flat, else one per line without commas: arguments, variable and argument definitions. */
function parenList(ctx: Ctx, nodes: readonly number[], blankLines = true): void {
  if (nodes.length === 0) return;
  open(GROUP);
  sText("(");
  open(INDENT);
  sLine(SOFT);
  nodes.forEach((n, i) => {
    if (i > 0) {
      open(IF_FLAT);
      sText(", ");
      close();
      sLine(SOFT);
    }
    ctx.print(n);
    if (blankLines && i < nodes.length - 1 && nextLineEmpty(ctx.tree, n)) sHardline();
  });
  close();
  sLine(SOFT);
  sText(")");
  close();
}

/** A list node's items (`arguments`, `variable_definitions`, `arguments_definition`) of kind `k`. */
const listOf = (ctx: Ctx, n: number, list: string, k: string) => {
  const l = first(ctx, n, list);
  return l === undefined ? [] : all(ctx, l, k);
};

/** printDescription: the description, then a line break (a line for an argument's non-block one). */
function description(ctx: Ctx, n: number): void {
  const d = first(ctx, n, "description");
  if (d === undefined) return;
  ctx.print(d);
  if (kind(ctx, n) === "input_value_definition" && !ctx.tree.text(d).startsWith('"""')) sLine(0);
  else sHardline();
}

/** printDirectives: an operation's or fragment's on a line of their own when they break, else after a space. */
function directives(ctx: Ctx, n: number): void {
  const list = first(ctx, n, "directives");
  if (list === undefined) return;
  const ds = all(ctx, list, "directive");
  const k = kind(ctx, n);
  if (k === "operation_definition" || k === "fragment_definition") {
    open(GROUP);
    sLine(0);
    joinLine(ctx, ds);
    close();
    return;
  }
  sText(" ");
  open(GROUP);
  open(INDENT);
  sLine(SOFT);
  joinLine(ctx, ds);
  close();
  close();
}

const joinLine = (ctx: Ctx, nodes: readonly number[]) =>
  nodes.forEach((n, i) => {
    if (i > 0) sLine(0);
    ctx.print(n);
  });

/** `{`, then `nodes` one per line, indented, then `}`. */
function block(ctx: Ctx, nodes: readonly number[]): void {
  sText("{");
  open(INDENT);
  sHardline();
  sequence(ctx, nodes);
  close();
  sHardline();
  sText("}");
}

/** The keyword `text` as written in `n`, or `text`. */
const keyword = (ctx: Ctx, text: string) => sText(text);

const operationDefinition: StreamRule<GraphqlOptions> = (n, ctx) => {
  const selection = first(ctx, n, "selection_set");
  const operation = first(ctx, n, "operation_type");
  // A shorthand query (`{ … }`).
  if (operation === undefined) return print(ctx, selection);
  const name = first(ctx, n, "name");
  const variables = listOf(ctx, n, "variable_definitions", "variable_definition");
  description(ctx, n);
  sToken(operation, ctx.tree.text(operation));
  if (name !== undefined) {
    sText(" ");
    ctx.print(name);
  } else if (variables.length > 0) sText(" ");
  parenList(ctx, variables, false);
  directives(ctx, n);
  sText(" ");
  print(ctx, selection);
};

const fragmentDefinition: StreamRule<GraphqlOptions> = (n, ctx) => {
  description(ctx, n);
  keyword(ctx, "fragment ");
  print(ctx, first(ctx, n, "fragment_name"));
  parenList(ctx, listOf(ctx, n, "variable_definitions", "variable_definition"), false);
  sText(" on ");
  const condition = first(ctx, n, "type_condition");
  if (condition !== undefined) print(ctx, first(ctx, condition, "named_type"));
  directives(ctx, n);
  sText(" ");
  print(ctx, first(ctx, n, "selection_set"));
};

const field: StreamRule<GraphqlOptions> = (n, ctx) => {
  open(GROUP);
  const alias = first(ctx, n, "alias");
  if (alias !== undefined) {
    print(ctx, first(ctx, alias, "name"));
    sText(": ");
  }
  print(ctx, first(ctx, n, "name"));
  parenList(ctx, listOf(ctx, n, "arguments", "argument"));
  directives(ctx, n);
  const selection = first(ctx, n, "selection_set");
  if (selection !== undefined) {
    sText(" ");
    ctx.print(selection);
  }
  close();
};

/** GraphQL's string escapes decoded (graphql-js's lexer), for prettier's printer, which prints the value. */
function cook(raw: string): string {
  return raw.replace(/\\(u\{[0-9A-Fa-f]+\}|u[0-9A-Fa-f]{4}|.)/g, (_, e: string) => {
    if (e.startsWith("u{")) return String.fromCodePoint(Number.parseInt(e.slice(2, -1), 16));
    if (e.startsWith("u") && e.length === 5) return String.fromCharCode(Number.parseInt(e.slice(1), 16));
    return { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[e] ?? e;
  });
}

/** graphql-js's dedentBlockStringLines: the block string's lines, common indentation and blank ends removed. */
export function blockStringLines(raw: string): string[] {
  const lines = raw.replaceAll('\\"""', '"""').split(/\r\n|[\n\r]/);
  let common = Number.MAX_SAFE_INTEGER;
  let firstNonEmpty: number | undefined;
  let lastNonEmpty = -1;
  lines.forEach((line, i) => {
    let indent = 0;
    while (indent < line.length && (line[indent] === " " || line[indent] === "\t")) indent++;
    if (indent === line.length) return;
    firstNonEmpty ??= i;
    lastNonEmpty = i;
    if (i !== 0 && indent < common) common = indent;
  });
  if (firstNonEmpty === undefined) return [];
  return lines
    .map((line, i) => (i === 0 ? line : line.slice(common)))
    .slice(firstNonEmpty, lastNonEmpty + 1);
}

const stringValue: StreamRule<GraphqlOptions> = (n, ctx) => {
  const text = ctx.tree.text(n);
  if (text.startsWith('"""')) {
    const lines = blockStringLines(text.slice(3, -3)).map((l) => l.replaceAll('"""', '\\"""'));
    if (lines.length === 1) lines[0] = (lines[0] as string).trim();
    const shown = lines.every((l) => l === "") ? [] : lines;
    sToken(n, '"""');
    for (const l of shown) {
      sHardline();
      if (l !== "") sText(l);
    }
    sHardline();
    sText('"""');
    return;
  }
  const value = cook(text.slice(1, -1));
  sToken(n, `"${value.replaceAll(/["\\]/g, "\\$&").replaceAll("\n", "\\n")}"`);
};

/** `[a, b]` flat, one per line broken: a list value. */
const listValue: StreamRule<GraphqlOptions> = (n, ctx) => {
  const values = all(ctx, n, "value");
  open(GROUP);
  sText("[");
  dangling(ctx, n);
  if (values.length > 0) {
    open(INDENT);
    sLine(SOFT);
    values.forEach((v, i) => {
      if (i > 0) {
        open(IF_FLAT);
        sText(", ");
        close();
        sLine(SOFT);
      }
      ctx.print(v);
    });
    close();
  }
  sLine(SOFT);
  sText("]");
  close();
};

const objectValue: StreamRule<GraphqlOptions> = (n, ctx) => {
  const fields = all(ctx, n, "object_field");
  const space = ctx.options.bracketSpacing && fields.length > 0 ? " " : "";
  open(GROUP);
  sText("{");
  sText(space);
  dangling(ctx, n);
  if (fields.length > 0) {
    open(INDENT);
    sLine(SOFT);
    fields.forEach((f, i) => {
      if (i > 0) {
        open(IF_FLAT);
        sText(", ");
        close();
        sLine(SOFT);
      }
      ctx.print(f);
    });
    close();
  }
  sLine(SOFT);
  if (space !== "") {
    open(IF_FLAT);
    sText(space);
    close();
  }
  sText("}");
  close();
};

/** printDanglingComments with indent: each on a line of its own, indented. */
function dangling(ctx: Ctx, n: number): void {
  const comments = ctx.danglingComments(n);
  if (comments.length === 0) return;
  open(INDENT);
  for (const c of comments) {
    sHardline();
    ctx.comment(c);
  }
  close();
}

/** `name: value`: an argument, an object field. */
const pair: StreamRule<GraphqlOptions> = (n, ctx) => {
  print(ctx, first(ctx, n, "name"));
  sText(": ");
  print(ctx, first(ctx, n, "value"));
};

const directive: StreamRule<GraphqlOptions> = (n, ctx) => {
  sText("@");
  print(ctx, first(ctx, n, "name"));
  parenList(ctx, listOf(ctx, n, "arguments", "argument"));
};

const variableDefinition: StreamRule<GraphqlOptions> = (n, ctx) => {
  description(ctx, n);
  print(ctx, first(ctx, n, "variable"));
  sText(": ");
  print(ctx, first(ctx, n, "type"));
  defaultValue(ctx, n);
  directives(ctx, n);
};

function defaultValue(ctx: Ctx, n: number): void {
  const d = first(ctx, n, "default_value");
  if (d === undefined) return;
  sText(" = ");
  print(ctx, first(ctx, d, "value"));
}

/** An object type's, input object's or interface's definition or extension. */
const typeDefinition =
  (word: string, extension: boolean): StreamRule<GraphqlOptions> =>
  (n, ctx) => {
    if (extension) sText("extend ");
    else description(ctx, n);
    keyword(ctx, word);
    sText(" ");
    print(ctx, first(ctx, n, "name"));
    const implemented = first(ctx, n, "implements_interfaces");
    if (implemented !== undefined) {
      sText(" implements ");
      open(INDENT);
      open(GROUP);
      interfaces(ctx, implemented).forEach((t, i) => {
        if (i > 0) {
          sText(" &");
          sLine(0);
        }
        ctx.print(t);
      });
      close();
      close();
    }
    directives(ctx, n);
    const fields = items(ctx, n)
      .filter((c) => ["fields_definition", "input_fields_definition"].includes(kind(ctx, c)))
      .flatMap((c) => items(ctx, c));
    if (fields.length > 0) {
      sText(" ");
      block(ctx, fields);
    }
  };

/** An `implements_interfaces` chain's named types, in order (the grammar nests it left-recursively). */
function interfaces(ctx: Ctx, n: number): number[] {
  const out: number[] = [];
  for (const c of items(ctx, n)) {
    if (kind(ctx, c) === "implements_interfaces") out.push(...interfaces(ctx, c));
    else if (kind(ctx, c) === "named_type") out.push(c);
  }
  return out;
}

const fieldDefinition: StreamRule<GraphqlOptions> = (n, ctx) => {
  description(ctx, n);
  print(ctx, first(ctx, n, "name"));
  parenList(ctx, listOf(ctx, n, "arguments_definition", "input_value_definition"));
  sText(": ");
  print(ctx, first(ctx, n, "type"));
  directives(ctx, n);
};

const inputValueDefinition: StreamRule<GraphqlOptions> = (n, ctx) => {
  description(ctx, n);
  print(ctx, first(ctx, n, "name"));
  sText(": ");
  print(ctx, first(ctx, n, "type"));
  defaultValue(ctx, n);
  directives(ctx, n);
};

const directiveDefinition: StreamRule<GraphqlOptions> = (n, ctx) => {
  description(ctx, n);
  sText("directive @");
  print(ctx, first(ctx, n, "name"));
  parenList(ctx, listOf(ctx, n, "arguments_definition", "input_value_definition"));
  directives(ctx, n);
  if (hasToken(ctx, n, "repeatable")) sText(" repeatable");
  sText(" on ");
  locations(ctx, first(ctx, n, "directive_locations")).forEach((l, i) => {
    if (i > 0) sText(" | ");
    sToken(l, ctx.tree.text(l));
  });
};

/** A `directive_locations` chain's locations, in order. */
function locations(ctx: Ctx, n: number | undefined): number[] {
  if (n === undefined) return [];
  const out: number[] = [];
  for (const c of items(ctx, n)) {
    if (kind(ctx, c) === "directive_locations") out.push(...locations(ctx, c));
    else if (kind(ctx, c) === "directive_location") out.push(c);
  }
  return out;
}

const directiveExtension: StreamRule<GraphqlOptions> = (n, ctx) => {
  sText("extend directive @");
  print(ctx, first(ctx, n, "name"));
  directives(ctx, n);
};

const enumTypeDefinition =
  (extension: boolean): StreamRule<GraphqlOptions> =>
  (n, ctx) => {
    description(ctx, n);
    if (extension) sText("extend ");
    sText("enum ");
    print(ctx, first(ctx, n, "name"));
    directives(ctx, n);
    const values = first(ctx, n, "enum_values_definition");
    const list = values === undefined ? [] : all(ctx, values, "enum_value_definition");
    if (list.length > 0) {
      sText(" ");
      block(ctx, list);
    }
  };

const enumValueDefinition: StreamRule<GraphqlOptions> = (n, ctx) => {
  description(ctx, n);
  print(ctx, first(ctx, n, "enum_value"));
  directives(ctx, n);
};

const schemaDefinition: StreamRule<GraphqlOptions> = (n, ctx) => {
  description(ctx, n);
  sText("schema");
  directives(ctx, n);
  sText(" {");
  const ops = all(ctx, n, "root_operation_type_definition");
  if (ops.length > 0) {
    open(INDENT);
    sHardline();
    sequence(ctx, ops);
    close();
  }
  sHardline();
  sText("}");
};

const schemaExtension: StreamRule<GraphqlOptions> = (n, ctx) => {
  sText("extend schema");
  directives(ctx, n);
  const ops = all(ctx, n, "root_operation_type_definition");
  if (ops.length === 0) return;
  sText(" ");
  block(ctx, ops);
};

const rootOperationType: StreamRule<GraphqlOptions> = (n, ctx) => {
  print(ctx, first(ctx, n, "operation_type"));
  sText(": ");
  print(ctx, first(ctx, n, "named_type"));
};

const fragmentSpread: StreamRule<GraphqlOptions> = (n, ctx) => {
  sText("...");
  print(ctx, first(ctx, n, "fragment_name"));
  parenList(ctx, listOf(ctx, n, "arguments", "argument"));
  directives(ctx, n);
};

const inlineFragment: StreamRule<GraphqlOptions> = (n, ctx) => {
  sText("...");
  const condition = first(ctx, n, "type_condition");
  if (condition !== undefined) {
    sText(" on ");
    print(ctx, first(ctx, condition, "named_type"));
  }
  directives(ctx, n);
  sText(" ");
  print(ctx, first(ctx, n, "selection_set"));
};

const unionTypeDefinition =
  (extension: boolean): StreamRule<GraphqlOptions> =>
  (n, ctx) => {
    open(GROUP);
    description(ctx, n);
    open(GROUP);
    if (extension) sText("extend ");
    sText("union ");
    print(ctx, first(ctx, n, "name"));
    directives(ctx, n);
    const members = memberTypes(ctx, first(ctx, n, "union_member_types"));
    if (members.length > 0) {
      sText(" =");
      open(IF_FLAT);
      sText(" ");
      close();
      open(INDENT);
      open(IF_BROKEN);
      sLine(0);
      sText("| ");
      close();
      members.forEach((t, i) => {
        if (i > 0) {
          sLine(0);
          sText("| ");
        }
        ctx.print(t);
      });
      close();
    }
    close();
    close();
  };

/** A `union_member_types` chain's named types, in order. */
function memberTypes(ctx: Ctx, n: number | undefined): number[] {
  if (n === undefined) return [];
  const out: number[] = [];
  for (const c of items(ctx, n)) {
    if (kind(ctx, c) === "union_member_types") out.push(...memberTypes(ctx, c));
    else if (kind(ctx, c) === "named_type") out.push(c);
  }
  return out;
}

const scalarTypeDefinition =
  (extension: boolean): StreamRule<GraphqlOptions> =>
  (n, ctx) => {
    description(ctx, n);
    if (extension) sText("extend ");
    sText("scalar ");
    print(ctx, first(ctx, n, "name"));
    directives(ctx, n);
  };

/** A node that prints its one child: the grammar's wrappers around graphql-js's nodes. */
const child: StreamRule<GraphqlOptions> = (n, ctx) => {
  for (const c of items(ctx, n)) ctx.print(c);
};

/** A node that prints as its source text, a single token. */
const token: StreamRule<GraphqlOptions> = (n, ctx) => sToken(n, ctx.tree.text(n));

const rules = new Map<string, StreamRule<GraphqlOptions>>([
  [
    "document",
    (n, ctx) => {
      sequence(ctx, items(ctx, n));
    },
  ],
  ["source_file", child],
  ["definition", child],
  ["executable_definition", child],
  ["type_system_definition", child],
  ["type_system_extension", child],
  ["type_definition", child],
  ["type_extension", child],
  ["selection", child],
  ["value", child],
  ["type", child],
  ["description", child],
  ["fragment_name", child],
  ["enum_value", child],
  ["named_type", child],
  ["operation_definition", operationDefinition],
  ["fragment_definition", fragmentDefinition],
  ["selection_set", (n, ctx) => block(ctx, all(ctx, n, "selection"))],
  ["field", field],
  ["name", token],
  ["operation_type", token],
  ["int_value", token],
  ["float_value", token],
  ["boolean_value", token],
  ["null_value", token],
  ["string_value", stringValue],
  ["variable", (n, ctx) => {
    sText("$");
    print(ctx, first(ctx, n, "name"));
  }],
  ["list_value", listValue],
  ["object_value", objectValue],
  ["object_field", pair],
  ["argument", pair],
  ["directive", directive],
  ["variable_definition", variableDefinition],
  ["object_type_definition", typeDefinition("type", false)],
  ["object_type_extension", typeDefinition("type", true)],
  ["input_object_type_definition", typeDefinition("input", false)],
  ["input_object_type_extension", typeDefinition("input", true)],
  ["interface_type_definition", typeDefinition("interface", false)],
  ["interface_type_extension", typeDefinition("interface", true)],
  ["field_definition", fieldDefinition],
  ["input_value_definition", inputValueDefinition],
  ["directive_definition", directiveDefinition],
  ["directive_extension", directiveExtension],
  ["enum_type_definition", enumTypeDefinition(false)],
  ["enum_type_extension", enumTypeDefinition(true)],
  ["enum_value_definition", enumValueDefinition],
  ["schema_definition", schemaDefinition],
  ["schema_extension", schemaExtension],
  ["root_operation_type_definition", rootOperationType],
  ["fragment_spread", fragmentSpread],
  ["inline_fragment", inlineFragment],
  ["union_type_definition", unionTypeDefinition(false)],
  ["union_type_extension", unionTypeDefinition(true)],
  ["scalar_type_definition", scalarTypeDefinition(false)],
  ["scalar_type_extension", scalarTypeDefinition(true)],
  [
    "non_null_type",
    (n, ctx) => {
      child(n, ctx);
      sText("!");
    },
  ],
  [
    "list_type",
    (n, ctx) => {
      sText("[");
      child(n, ctx);
      sText("]");
    },
  ],
]);

// A comma means nothing (graphql-js reads it as whitespace), and a string means its value: a block string its
// dedented lines, a quoted one its decoded characters.
const normalize: Normalize = (lexemes, _text, tree) =>
  lexemes.map((l) => {
    const k = tree.kindName(l.node);
    if (k === "comma") return undefined;
    if (k === "string_value")
      return l.text.startsWith('"""')
        ? `block:${blockStringLines(l.text.slice(3, -3)).join("\n").trim()}`
        : `str:${cook(l.text.slice(1, -1))}`;
    // A leading `|` or `&` before the first member goes.
    if ((l.text === "|" || l.text === "&") && leads(tree, l.node)) return undefined;
    return l.text;
  });

/** Whether token `n` (`|` or `&`) comes before the first member of its list. */
function leads(tree: Parameters<Normalize>[2], n: number): boolean {
  const parent = tree.parent(n);
  if (parent === NO_NODE) return false;
  for (let i = 0; i < tree.count(parent); i++) {
    const c = tree.child(parent, i);
    if (c === n) return true;
    if (tree.named(c) && !["comment", "comma"].includes(tree.kindName(c)) && tree.kindName(c) !== "union_member_types" && tree.kindName(c) !== "implements_interfaces" && tree.kindName(c) !== "directive_locations") return false;
  }
  return false;
}

// The grammar's list nodes the rules print item by item, never through `print`: a comment the core gives one goes
// to its first item (leading) or its last (trailing), the graphql-js node beside it.
const LISTS = new Set([
  "variable_definitions",
  "arguments",
  "arguments_definition",
  "directives",
  "fields_definition",
  "input_fields_definition",
  "enum_values_definition",
  "implements_interfaces",
  "union_member_types",
  "directive_locations",
  "type_condition",
  "alias",
  "default_value",
]);

/**
 * prettier's attach over graphql-js's AST, where a comma is whitespace and a list is its items: the core's
 * neighbours with commas skipped and the list nodes above resolved to the item next to the comment.
 */
const handleComment: CommentHandler<GraphqlOptions> = (c) => {
  const { tree } = c;
  const code = (n: number) => tree.named(n) && tree.kindName(n) !== "comment";
  const sibling = (n: number | undefined, step: 1 | -1): number | undefined => {
    let at = n;
    while (at !== undefined && tree.kindName(at) === "comma") {
      const parent = tree.parent(at);
      let i = 0;
      while (tree.child(parent, i) !== at) i++;
      at = undefined;
      for (let j = i + step; j >= 0 && j < tree.count(parent); j += step) {
        const k = tree.child(parent, j);
        if (code(k)) {
          at = k;
          break;
        }
      }
    }
    return at;
  };
  const edge = (n: number | undefined, last: boolean): number | undefined => {
    let at = n;
    while (at !== undefined && LISTS.has(tree.kindName(at))) {
      const kids: number[] = [];
      for (let i = 0; i < tree.count(at); i++) if (code(tree.child(at, i))) kids.push(tree.child(at, i));
      const next = last ? kids.findLast((k) => tree.kindName(k) !== "comma") : kids.find((k) => tree.kindName(k) !== "comma");
      if (next === undefined) return at;
      at = next;
    }
    return at;
  };
  const preceding = edge(sibling(c.preceding, -1), true);
  const following = edge(sibling(c.following, 1), false);
  if (preceding === c.preceding && following === c.following) return undefined;
  if (c.placement === "ownLine") {
    if (following !== undefined) return { node: following, as: "leading" };
    if (preceding !== undefined) return { node: preceding, as: "trailing" };
  } else if (c.placement === "endOfLine") {
    if (preceding !== undefined) return { node: preceding, as: "trailing" };
    if (following !== undefined) return { node: following, as: "leading" };
  } else {
    if (following !== undefined) return { node: following, as: "leading" };
    if (preceding !== undefined) return { node: preceding, as: "trailing" };
  }
  return { node: c.enclosing, as: "dangling" };
};

/** hasPrettierIgnore: a node a `# prettier-ignore` comment is attached to prints as written. */
const ignored = (n: number, ctx: Ctx) =>
  [...ctx.leadingComments(n), ...ctx.trailingComments(n)].some((c) => ctx.tree.text(c).slice(1).trim() === "prettier-ignore");

const base = defineLanguage(grammar, {
  parser: language,
  atoms: ["string_value"],
  dropped: ["comma"],
  lineComments: { comment: "#" },
  defaults,
  settings: prettierSettings,
  normalize,
  // printComment: `#` and the comment's text, its trailing whitespace trimmed.
  comment: (raw) => raw.trimEnd(),
  handleComment,
});

/** GraphQL as prettier 3.9.9's `graphql` parser and printer lay it out. */
export const graphql: Language<GraphqlOptions> = {
  ...base,
  stream: {
    rules,
    lists: new Set(),
    keepsSource: ignored,
    finalLine: ({ tree }) => tree.count(tree.root) > 0,
  },
};
