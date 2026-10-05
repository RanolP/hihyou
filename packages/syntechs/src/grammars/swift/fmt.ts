// Swift as swift-format 6.3.0 prints it with its default configuration (100 columns, 2-space indent). The
// formatter does not lay Swift out yet: it keeps a file as written, and refuses one whose layout it can tell
// swift-format would change, so its output is never silently wrong for those causes. Each refusal names the
// swift-format behaviour a later rule has to port.

import { prettierDefaults, type PrettierOptions, prettierSettings } from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { sToken } from "../../fmt/stream.js";
import { NO_NODE } from "../../core/arena.js";
import { type FormatTree, firstLeaf, nextLeaf, prevLeaf } from "../../fmt/tree.js";
import type { StreamRules } from "../../fmt/stream-format.js";
import type { Normalize } from "../../fmt/check.js";
import { grammar } from "./bundle.js";
import { language } from "./index.js";
import { statementTokens } from "./layout.js";
import { prettyPrint, tk } from "./pretty.js";

export type SwiftOptions = PrettierOptions;

const defaults: SwiftOptions = { ...prettierDefaults, printWidth: 100, tabWidth: 2 };

/** Kinds whose text swift-format never breaks, so it may run past the line width. */
const UNBREAKABLE = new Set([
  "comment",
  "multiline_comment",
  "line_string_literal",
  "multi_line_string_literal",
  "raw_string_literal",
  "regex_literal",
]);

const DIRECTIVE = /^#(if|elseif|else)\b/;

/**
 * Whether `leaf` lies in a comment or string that starts its line: swift-format lets that run past the width,
 * but breaks before one that follows code on its line (`let m: T =` then the string on the next line).
 */
function unbreakable(tree: FormatTree, leaf: number): boolean {
  for (let n = leaf; n !== NO_NODE; n = tree.parent(n))
    if (UNBREAKABLE.has(tree.kindName(n))) {
      const first = firstLeaf(tree, n);
      return tree.lf(first) > 0 || prevLeaf(tree, first) === NO_NODE;
    }
  return false;
}

// Binary operators swift-format spaces on both sides (`spacesAroundRangeFormationOperators` is off by default, so
// `..<` and `...` are left alone).
const SPACED_PARENTS = new Set([
  "additive_expression",
  "multiplicative_expression",
  "comparison_expression",
  "equality_expression",
  "conjunction_expression",
  "disjunction_expression",
  "nil_coalescing_expression",
  "infix_expression",
  "bitwise_operation",
  "assignment",
  "ternary_expression",
]);
const SPACED_TOKENS = new Set(["=", "->", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]);
/** Statement lists, whose statements each start a line at one indent past the brace that opens them. */
const BODIES = new Set(["statements", "class_body", "protocol_body", "enum_class_body", "computed_property"]);
/** Keywords swift-format always spaces from a bracket after them (`if (x)`, never `if(x)`). */
const CONTROL = new Set(["if", "while", "guard", "switch", "return", "for", "in", "catch", "where", "throw", "else", "repeat", "await", "try"]);
/** The nodes a member chain nests as, from a `.` up to the whole chain. */
const CHAIN = new Set(["navigation_suffix", "navigation_expression", "call_expression"]);
const OPENERS: Record<string, string> = { "{": "}", "(": ")", "[": "]" };

interface Edit {
  from: number;
  to: number;
  text: string;
}

/**
 * Throws, naming the swift-format behaviour, when the file as written is not what swift-format prints; returns
 * the statements past the width it lays out as swift-format does, each as the text replacing it.
 */
function refuseUnsupported(tree: FormatTree, width: number): Edit[] {
  const text = tree.text(tree.root);
  const endCol = (leaf: number) => {
    const t = tree.text(leaf);
    const lf = t.lastIndexOf("\n");
    return lf < 0 ? tree.col(leaf) + t.length : t.length - lf - 1;
  };
  const leaves: number[] = [];
  const collect = (n: number) => {
    if (tree.count(n) === 0) leaves.push(n);
    else for (let i = 0; i < tree.count(n); i++) collect(tree.child(n, i));
  };
  collect(tree.root);
  // The scanner reads a `;` as a statement end that the tree does not keep, so it shows only in the text between
  // two leaves; swift-format drops it, or splits the line it joins.
  let cursor = 0;
  const starts = new Map<number, number>();
  for (const l of [...leaves, NO_NODE]) {
    const t = l === NO_NODE ? "" : tree.text(l);
    if (t === "" && l !== NO_NODE) continue;
    const start = l === NO_NODE ? text.length : text.indexOf(t, cursor);
    if (start < 0) throw new Error(`leaf \`${t}\` not found in the text after offset ${cursor}`);
    if (text.slice(cursor, start).includes(";")) throw new Error(`a semicolon (one statement per line): before \`${t}\``);
    starts.set(l, start);
    cursor = start + t.length;
  }
  const index = new Map(leaves.map((l, i) => [l, i]));
  /** Whether leaf `i` is the first on its line. */
  const startsLine = (i: number) =>
    i === 0 || tree.lf(leaves[i] as number) > 0 || tree.text(leaves[i - 1] as number).endsWith("\n");
  /** Spaces between leaf `i` and the one before it, or undefined across a line break. */
  const gap = (i: number) => (startsLine(i) ? undefined : tree.col(leaves[i] as number) - endCol(leaves[i - 1] as number));
  /** The indent of the line leaf `i` stands on: the column of that line's first leaf. */
  const lineIndent = (i: number) => {
    while (!startsLine(i)) i--;
    return tree.col(leaves[i] as number);
  };
  const at = (i: number) => {
    const l = leaves[i] as number;
    return `\`${tree.text(l).split("\n")[0]}\` (after \`${i > 0 ? tree.text(leaves[i - 1] as number).split("\n").pop() : ""}\`)`;
  };
  const inLiteral = (l: number) => {
    for (let n = tree.parent(l); n !== NO_NODE; n = tree.parent(n)) if (UNBREAKABLE.has(tree.kindName(n))) return true;
    return false;
  };
  const parentKind = (l: number) => tree.kindName(tree.parent(l));
  const isComment = (l: number) => tree.kindName(l) === "comment" || tree.kindName(l) === "multiline_comment";
  if (/^[ ]*\t/m.test(text)) throw new Error("a tab in an indent (indentation)");

  // Spacing.
  let directives = 0;
  const opened: { i: number; close: string }[] = [];
  for (const [i, l] of leaves.entries()) {
    const t = tree.text(l);
    const kind = tree.kindName(l);
    if (parentKind(l) === "directive") {
      // swift-format indents a directive with the statements around it, or a level in per enclosing `#if`.
      if (startsLine(i) && /^#(if|elseif|else|endif)$/.test(t)) {
        const top = opened[opened.length - 1];
        const want = top === undefined ? 0 : lineIndent(top.i) + 2;
        const nest = directives - (t === "#if" ? 0 : 1);
        if (tree.col(l) !== want && tree.col(l) !== want + 2 * nest)
          throw new Error(`a directive not at the indent of the statements around it (indentation): ${at(i)}`);
      }
      if (t === "#if") directives++;
      else if (t === "#endif") directives--;
      continue;
    }
    if (inLiteral(l)) continue;
    const g = gap(i);
    const prevText = i > 0 ? tree.text(leaves[i - 1] as number) : "";
    // swift-format puts two spaces before a trailing line comment, and one or none between code tokens.
    if (kind === "comment" && g !== undefined && g !== 2)
      throw new Error(`trailing comment not two spaces after the code (comment spacing): ${at(i)}`);
    if (!isComment(l) && i > 0 && !isComment(leaves[i - 1] as number) && g !== undefined) {
      if (g > 1) throw new Error(`more than one space between tokens (token spacing): ${at(i)}`);
      if (g > 0 && (t === ")" || t === "]" || prevText === "(" || prevText === "["))
        throw new Error(`a space just inside a bracket (bracket spacing): ${at(i)}`);
      if (g === 0 && (t === "(" || t === "[") && CONTROL.has(prevText) && !tree.named(leaves[i - 1] as number))
        throw new Error(`a keyword joined to the bracket after it (keyword spacing): ${at(i)}`);
      if (prevText === ":" && t !== ")" && t !== "]" && g !== 1)
        throw new Error(`a colon not followed by one space (colon spacing): ${at(i)}`);
      if (t === ":" && g !== 0 && parentKind(l) !== "ternary_expression")
        throw new Error(`a space before a colon (colon spacing): ${at(i)}`);
    }
    if ((t === "else" || t === "catch") && startsLine(i) && prevText === "}")
      throw new Error(`\`${t}\` on the line after \`}\` (line joining)`);
    if (isComment(l) || (tree.named(l) && kind !== "custom_operator")) {
      if (startsLine(i)) checkIndent(i);
      continue;
    }
    const parent = parentKind(l);
    const binary =
      SPACED_PARENTS.has(parent) &&
      (tree.fieldName(l) === "op" || (parent === "ternary_expression" && (t === "?" || t === ":")));
    if (SPACED_TOKENS.has(t) || binary) {
      const before = gap(i);
      const after = i + 1 < leaves.length ? gap(i + 1) : undefined;
      if ((before !== undefined && before !== 1) || (after !== undefined && after !== 1))
        throw new Error(`operator not spaced on both sides (operator spacing): ${at(i)}`);
    }
    if (t === ",") {
      const after = i + 1 < leaves.length ? gap(i + 1) : undefined;
      if (gap(i) !== undefined && gap(i) !== 0) throw new Error(`space before a comma (comma spacing): ${at(i)}`);
      if (after !== undefined && after !== 1) throw new Error(`comma not followed by one space (comma spacing): ${at(i)}`);
    }
    if (t === "{") {
      const prev = i > 0 ? tree.text(leaves[i - 1] as number) : "";
      const before = gap(i);
      if (before !== undefined && before !== (prev === "(" || prev === "[" ? 0 : 1))
        throw new Error(`brace not one space after what precedes it (brace spacing): ${at(i)}`);
      const next = leaves[i + 1];
      const after = i + 1 < leaves.length ? gap(i + 1) : undefined;
      if (next !== undefined && after !== undefined && after !== (tree.text(next) === "}" ? 0 : 1))
        throw new Error(`brace content not one space inside it (brace spacing): ${at(i)}`);
    }
    if (t === "}") {
      const before = gap(i);
      const prev = i > 0 ? tree.text(leaves[i - 1] as number) : "";
      if (before !== undefined && before !== (prev === "{" ? 0 : 1))
        throw new Error(`brace content not one space inside it (brace spacing): ${at(i)}`);
    }
    if (t === "." && startsLine(i) && parent === "navigation_suffix") {
      // A bare name called through a member on the next line, as the value of `=` (`let a = b` then `.c()`):
      // swift-format breaks after the `=` too. It keeps `b.c` then `.d()`, and `b` then `.c` then `.d()`.
      let chain = tree.parent(l);
      while (CHAIN.has(tree.kindName(tree.parent(chain)))) chain = tree.parent(chain);
      const n = tree.parent(chain);
      const bare = index.get(firstLeaf(tree, chain)) === i - 1 && leaves[i + 2] !== undefined && tree.text(leaves[i + 2] as number) === "(";
      let eq: number | undefined;
      for (let c = 0; c < tree.count(n); c++)
        if (!tree.named(tree.child(n, c)) && tree.text(tree.child(n, c)) === "=") eq = index.get(tree.child(n, c));
      if (bare && eq !== undefined && eq + 1 < leaves.length && !startsLine(eq + 1))
        throw new Error(`a member chain continued on a line of its own after code that follows \`=\` (line breaking): ${at(i)}`);
    }
    if (startsLine(i)) checkIndent(i);
    if (OPENERS[t] !== undefined) opened.push({ i, close: OPENERS[t] as string });
    else if (t === "}" || t === ")" || t === "]") opened.pop();
  }

  // Indentation: a statement at one indent past the line of its body's `{` (top level at 0), the first line
  // inside a bracket that ends its line one indent past that line, and a closing bracket that starts a line at
  // the indent of its opener's line.
  function checkIndent(i: number): void {
    if (directives > 0) return;
    const l = leaves[i] as number;
    const col = tree.col(l);
    const t = tree.text(l);
    const top = opened[opened.length - 1];
    if (!tree.named(l) && top !== undefined && t === top.close) {
      if (col !== lineIndent(top.i)) throw new Error(`closing bracket not at its opener's indent (indentation): ${at(i)}`);
      return;
    }
    if (top !== undefined && top.i === i - 1) {
      const kind = tree.kindName(tree.parent(leaves[top.i] as number));
      const want = lineIndent(top.i) + (kind === "switch_statement" ? 0 : 2);
      if (col !== want) throw new Error(`first line inside a bracket not indented ${want} (indentation): ${at(i)}`);
      return;
    }
    // A statement's first leaf: the first leaf of a node whose parent is a statement list.
    for (let n = l; ; ) {
      const p = tree.parent(n);
      if (p === NO_NODE) return;
      if (BODIES.has(tree.kindName(p)) || p === tree.root) {
        const want = p === tree.root || top === undefined ? 0 : lineIndent(top.i) + 2;
        // A comment the tree ends a body with may belong to the line after it (the next `case`, or the outer
        // statement after a nested block), which swift-format indents it with.
        let next = i + 1;
        while (next < leaves.length && (isComment(leaves[next] as number) || !startsLine(next))) next++;
        const following = next < leaves.length ? tree.col(leaves[next] as number) : 0;
        if (col !== want && !(isComment(l) && col === following)) throw new Error(`statement not indented ${want} (indentation): ${at(i)}`);
        return;
      }
      if (index.get(firstLeaf(tree, p)) !== i) return;
      n = p;
    }
  }

  // A statement past the width is laid out by swift-format's printer when it stands on one line of its own, or
  // when its header (an `if` or `guard` through the body's `{`) does and holds every leaf past the width.
  const long = new Map<number, number[]>();
  // The elements of a dictionary literal broken one per line, by key: each lays out on its own line.
  const elements = new Map<number, { colon: number; value: number; comma: number | undefined }>();
  const elementOf = (n: number, p: number): number | undefined => {
    if (tree.kindName(p) !== "dictionary_literal") return undefined;
    const kids = Array.from({ length: tree.count(p) }, (_, i) => tree.child(p, i));
    let at = kids.indexOf(n);
    // Back to the element's key: the child after `[` or a `,`.
    while (at > 1 && tree.text(kids[at - 1] as number) !== ",") at--;
    const key = kids[at] as number;
    const colon = kids[at + 1];
    const value = kids[at + 2];
    if (at < 1 || colon === undefined || value === undefined || tree.text(colon) !== ":" || tree.lf(firstLeaf(tree, key)) === 0)
      return undefined;
    const after = kids[at + 3];
    elements.set(key, { colon, value, comma: after !== undefined && tree.text(after) === "," ? after : undefined });
    return key;
  };
  const statementOf = (leaf: number) => {
    for (let n = leaf; ; n = tree.parent(n)) {
      const p = tree.parent(n);
      if (p === NO_NODE) return NO_NODE;
      const element = elementOf(n, p);
      if (element !== undefined) return element;
      // An `else if` on the line of the `}` before it lays its header out on its own.
      if (tree.kindName(n) === "if_statement" && tree.kindName(p) === "if_statement" && tree.lf(firstLeaf(tree, n)) === 0) return n;
      // A closure's statement on the line of its `{` is laid out with the statement holding the closure.
      const inlineClosure = tree.kindName(tree.parent(p)) === "lambda_literal" && tree.lf(firstLeaf(tree, n)) === 0;
      // A body's own braces are its declaration's: the `{` ends its header.
      const brace = tree.count(n) === 0 && (tree.text(n) === "{" || tree.text(n) === "}");
      if ((BODIES.has(tree.kindName(p)) && !inlineClosure && !brace) || p === tree.root) return n;
    }
  };
  const accessEdits: { at: number; leaf: number; text: string }[] = [];
  const walk = (n: number) => {
    const kind = tree.kindName(n);
    if (kind === "class_declaration") moveExtensionAccess(n);
    if (tree.count(n) === 0) {
      if (endCol(n) > width && !unbreakable(tree, n)) {
        const stmt = statementOf(n);
        if (stmt === NO_NODE)
          throw new Error(`code past column ${width} (line breaking): \`${tree.text(n)}\` ends at column ${endCol(n)}`);
        long.set(stmt, [...(long.get(stmt) ?? []), n]);
      }
      return;
    }
    for (let i = 0; i < tree.count(n); i++) walk(tree.child(n, i));
  };
  /**
   * NoAccessLevelOnExtensionDeclaration: an extension's `public`, `package` or `fileprivate` moves onto each member
   * that has no access level of its own (a `private` one as `fileprivate`, its effective level); `internal` goes.
   * The members are the extension's own declarations of the kinds the rule visits, `#if` blocks' included.
   */
  function moveExtensionAccess(n: number): void {
    const kids = Array.from({ length: tree.count(n) }, (_, i) => tree.child(n, i));
    if (!kids.some((c) => tree.kindName(c) === "extension")) return;
    const access = accessModifier(kids.find((c) => tree.kindName(c) === "modifiers"));
    if (access === undefined) return;
    const keyword = tree.text(access);
    if (!["public", "private", "fileprivate", "package", "internal"].includes(keyword)) return;
    const ai = index.get(firstLeaf(tree, access)) as number;
    const from = starts.get(leaves[ai] as number) as number;
    accessEdits.push({ at: from, leaf: ai, text: "" });
    edits0.push({ from, to: starts.get(leaves[ai + 1] as number) as number, text: "" });
    if (keyword === "internal") return;
    const add = keyword === "private" ? "fileprivate" : keyword;
    const body = kids.find((c) => tree.kindName(c) === "class_body");
    if (body === undefined) return;
    for (let i = 0; i < tree.count(body); i++) {
      const m = tree.child(body, i);
      if (!memberVisited(m)) continue;
      const modifiers = Array.from({ length: tree.count(m) }, (_, j) => tree.child(m, j)).find((c) => tree.kindName(c) === "modifiers");
      if (accessModifier(modifiers) !== undefined) continue;
      // Before the first modifier (attributes are no modifiers to swift-syntax), else before the declaration's keyword.
      let before = NO_NODE;
      if (modifiers !== undefined)
        for (let j = 0; j < tree.count(modifiers) && before === NO_NODE; j++)
          if (tree.kindName(tree.child(modifiers, j)) !== "attribute") before = tree.child(modifiers, j);
      const leaf = before !== NO_NODE ? firstLeaf(tree, before) : modifiers !== undefined ? nextLeaf(tree, lastLeafOf(modifiers)) : firstLeaf(tree, m);
      const li = index.get(leaf) as number;
      let end = li;
      while (end + 1 < leaves.length && !startsLine(end + 1)) end++;
      if (endCol(leaves[end] as number) + add.length + 1 > width)
        throw new Error(`a member past column ${width} once the extension's access level moves onto it (NoAccessLevelOnExtensionDeclaration): ${at(li)}`);
      const offset = starts.get(leaf) as number;
      accessEdits.push({ at: offset, leaf: li, text: `${add} ` });
      edits0.push({ from: offset, to: offset, text: `${add} ` });
    }
  }
  /** The access level among `modifiers` (`private(set)` included, `open` not), as swift-format's accessLevelModifier. */
  function accessModifier(modifiers: number | undefined): number | undefined {
    if (modifiers === undefined) return undefined;
    for (let j = 0; j < tree.count(modifiers); j++) {
      const c = tree.child(modifiers, j);
      if (tree.kindName(c) !== "visibility_modifier") continue;
      const word = tree.child(c, 0);
      if (["public", "private", "fileprivate", "internal", "package"].includes(tree.text(word))) return word;
    }
    return undefined;
  }
  /** The declarations NoAccessLevelOnExtensionDeclaration gives an access level: not a nested extension or protocol. */
  function memberVisited(m: number): boolean {
    const k = tree.kindName(m);
    if (["function_declaration", "init_declaration", "property_declaration", "typealias_declaration", "subscript_declaration"].includes(k))
      return true;
    if (k !== "class_declaration") return false;
    for (let j = 0; j < tree.count(m); j++)
      if (["class", "struct", "enum", "actor"].includes(tree.kindName(tree.child(m, j)))) return true;
    return false;
  }
  const edits0: Edit[] = [];
  walk(tree.root);
  const edits: Edit[] = [];
  /** The statement laid out as swift-format lays it out, or undefined when that is what is written. */
  const layOut = (stmt: number, past: number[]): Edit | undefined => {
    const first = index.get(firstLeaf(tree, stmt)) as number;
    // `} else if …`: the header after the `} else ` its line starts with, laid out as the rest of that line.
    const elseIf =
      tree.kindName(stmt) === "if_statement" &&
      tree.kindName(tree.parent(stmt)) === "if_statement" &&
      !startsLine(first) &&
      first >= 2 &&
      startsLine(first - 2) &&
      tree.text(leaves[first - 2] as number) === "}" &&
      tree.text(leaves[first - 1] as number) === "else" &&
      gap(first - 1) === 1 &&
      gap(first) === 1;
    const element = elements.get(stmt);
    const { tokens, last: end } = statementTokens(tree, stmt, (leaf) => gap(index.get(firstLeaf(tree, leaf)) as number), element);
    const lastLeaf = tree.count(end) === 0 ? end : lastLeafOf(end);
    const last = index.get(lastLeaf) as number;
    if ((!startsLine(first) && !elseIf) || (last + 1 < leaves.length && !startsLine(last + 1)))
      throw new Error(`a statement past column ${width} sharing its line (line breaking): ${at(first)}`);
    // A line break inside the statement is kept as swift-format keeps it; a blank line or a comment is not ported.
    for (let i = first + 1; i <= last; i++) {
      if (isComment(leaves[i] as number))
        throw new Error(`a comment inside a statement past column ${width} (line breaking): ${at(i)}`);
      if (tree.lf(leaves[i] as number) > 1)
        throw new Error(`a blank line inside a statement past column ${width} (line breaking): ${at(i)}`);
    }
    for (const leaf of past)
      if ((index.get(leaf) as number) > last)
        throw new Error(`code past column ${width} after a statement's header (line breaking): ${at(index.get(leaf) as number)}`);
    const base = elseIf ? lineIndent(first) : tree.col(leaves[first] as number);
    const prefix = elseIf ? "} else " : "";
    const whole = prettyPrint(elseIf ? [tk.syntax("}"), tk.space, tk.syntax("else"), tk.space, ...tokens] : tokens, base, width, 2);
    if (!whole.startsWith(prefix)) throw new Error(`an else if header whose \`} else\` breaks (line breaking): ${at(first)}`);
    const printed = whole.slice(prefix.length);
    if (whole.split("\n").some((line, i) => line.length + (i === 0 ? base : 0) > width))
      throw new Error(`a line past column ${width} once laid out (line breaking): ${at(first)}`);
    const from = starts.get(leaves[first] as number) as number;
    const to = (starts.get(lastLeaf) as number) + tree.text(lastLeaf).length;
    return printed === text.slice(from, to) ? undefined : { from, to, text: printed };
  };
  for (const [stmt, past] of long) {
    const edit = layOut(stmt, past);
    if (edit !== undefined) edits.push(edit);
  }
  // swift-format lays out a statement spanning lines within the width too, keeping the line breaks it allows. One
  // whose layout is ported is laid out; another is kept as written.
  const spanning = new Set<number>();
  for (let i = 1; i < leaves.length; i++) {
    if (!startsLine(i)) continue;
    const stmt = statementOf(leaves[i] as number);
    if (stmt !== NO_NODE && !long.has(stmt) && firstLeaf(tree, stmt) !== leaves[i]) spanning.add(stmt);
  }
  const overlaps = (a: Edit, b: Edit) => a.from < b.to && b.from < a.to;
  for (const [i, a] of edits.entries())
    for (const b of edits.slice(i + 1))
      if (overlaps(a, b)) throw new Error(`a statement past column ${width} inside another one (line breaking): ${text.slice(b.from, b.from + 40).split("\n")[0]}`);
  for (const stmt of spanning) {
    let edit: Edit | undefined;
    try {
      edit = layOut(stmt, []);
    } catch {
      continue;
    }
    // A statement holding one laid out already (a closure's) is kept as written around it.
    if (edit !== undefined && !edits.some((e) => overlaps(e, edit))) edits.push(edit);
  }
  function lastLeafOf(n: number): number {
    while (tree.count(n) > 0) n = tree.child(n, tree.count(n) - 1);
    return n;
  }
  // OrderedImports sorts the imports, and groups attributed and declaration imports apart; this keeps only one
  // run of plain imports already in order.
  const imports: { name: string; plain: boolean; at: number }[] = [];
  const top: number[] = [];
  for (let c = 0; c < tree.count(tree.root); c++) {
    const n = tree.child(tree.root, c);
    if (isComment(n)) continue;
    // OrderedImports sorts within the imports between two `#if` lines, not across them.
    if (tree.kindName(n) === "directive") {
      if (imports.length > 0) imports.push({ name: "", plain: true, at: -2 });
      continue;
    }
    if (tree.kindName(n) === "import_declaration") {
      let name = "";
      let plain = true;
      for (let j = 0; j < tree.count(n); j++) {
        const k = tree.child(n, j);
        if (tree.kindName(k) === "identifier") name = tree.text(k);
        // An attribute other than `@testable` or `@_implementationOnly` (`@_spi(X)`) leaves the import a regular one.
        else if (tree.kindName(k) === "modifiers") {
          if (/@(testable|_implementationOnly)\b/.test(tree.text(k))) plain = false;
        } else if (tree.text(k) !== "import") plain = false;
      }
      imports.push({ name, plain, at: top.length });
    }
    top.push(n);
  }
  // A statement laid out holds no access level moved by NoAccessLevelOnExtensionDeclaration.
  for (const a of accessEdits)
    if (edits.some((e) => e.from <= a.at && a.at < e.to))
      throw new Error(`a statement laid out where an extension's access level moves (NoAccessLevelOnExtensionDeclaration): ${at(a.leaf)}`);
  edits.push(...edits0);
  if (imports.length > 1)
    for (const [k, imp] of imports.entries()) {
      const prev = imports[k - 1];
      if (imp.at === -2 || prev?.at === -2) continue;
      if (!imp.plain) throw new Error(`an attributed or declaration import among others (OrderedImports): ${imp.name}`);
      if (prev !== undefined && (prev.at !== imp.at - 1 || prev.name >= imp.name))
        throw new Error(`imports out of order or apart (OrderedImports): ${prev.name}, ${imp.name}`);
    }
  return edits;
}

/**
 * `text` with each conditional compilation block's body one level past its `#if`, as swift-format indents it,
 * nested blocks a level further. A block already indented so stays; one written flush with its directive (as
 * Xcode writes it) moves in; a file with both, or a string or comment spanning lines it would move, is refused.
 */
function indentConditionals(tree: FormatTree, text: string, width: number): string {
  const lines = text.split("\n");
  const indent = (s: string) => s.length - s.trimStart().length;
  let flush = false;
  let nested = false;
  for (const [i, line] of lines.entries()) {
    if (!DIRECTIVE.test(line.trimStart())) continue;
    const body = lines.slice(i + 1).find((l) => l.trim() !== "");
    if (body === undefined || body.trimStart().startsWith("#")) continue;
    if (indent(body) === indent(line) + 2) nested = true;
    else if (indent(body) === indent(line)) flush = true;
    else throw new Error(`#if body at line ${i + 2} neither flush with its directive nor one level in (conditional compilation)`);
  }
  if (!flush) return text;
  if (nested) throw new Error("#if bodies both flush with their directives and indented (conditional compilation)");
  for (let o = 0; o < tree.nodeCount; o++) {
    const n = tree.at(o);
    if (tree.count(n) === 0 && tree.text(n).includes("\n"))
      throw new Error("a string or comment spanning lines in a file whose #if bodies move (conditional compilation)");
  }
  let depth = 0;
  return lines
    .map((line) => {
      const t = line.trimStart();
      const directive = /^#(if|elseif|else|endif)\b/.exec(t)?.[1];
      if (directive === "endif" || directive === "else" || directive === "elseif") depth--;
      const moved = t === "" ? line : " ".repeat(2 * depth) + line;
      if (directive === "if" || directive === "else" || directive === "elseif") depth++;
      if (depth < 0) throw new Error("an #endif without its #if (conditional compilation)");
      if (moved.length > width && !t.startsWith("//")) throw new Error(`a line past column ${width} once its #if body moves in (line breaking)`);
      return moved;
    })
    .join("\n");
}

const stream: StreamRules<SwiftOptions> = {
  rules: new Map([
    [
      "source_file",
      (node, ctx) => {
        const { tree } = ctx;
        for (let o = 0; o < tree.nodeCount; o++) {
          const n = tree.at(o);
          if (tree.kindName(n) === "ERROR" || tree.missing(n)) {
            const next = nextLeaf(tree, n);
            throw new Error(`a parse error before \`${next === NO_NODE ? "" : tree.text(next).split("\n")[0]}\` (grammar)`);
          }
        }
        if (tree.text(node).includes("\r")) throw new Error("a carriage return (line endings)");
        const edits = refuseUnsupported(tree, ctx.options.printWidth);
        let source = tree.text(node);
        for (const e of edits.sort((a, b) => b.from - a.from)) source = source.slice(0, e.from) + e.text + source.slice(e.to);
        // A statement in a conditional compilation block may move in once laid out at its column as written.
        const original = tree.text(node);
        for (const e of edits) {
          const depth = original
            .slice(0, e.from)
            .split("\n")
            .reduce((d, line) => d + (/^[ \t]*#if\b/.test(line) ? 1 : /^[ \t]*#endif\b/.test(line) ? -1 : 0), 0);
          if (depth > 0) throw new Error("a statement laid out inside conditional compilation (line breaking)");
        }
        // swift-format drops trailing whitespace and keeps at most one blank line (`maximumBlankLines`), which
        // this does to the text as written; a string or comment whose own text would change by it is refused.
        for (let o = 0; o < tree.nodeCount; o++) {
          const n = tree.at(o);
          if (tree.count(n) === 0 && /[ \t]\n|\n[ \t]*\n[ \t]*\n/.test(tree.text(n)))
            throw new Error("trailing whitespace or blank lines inside a literal or comment (whitespace)");
        }
        const text = indentConditionals(tree, source, ctx.options.printWidth)
          .replace(/[ \t]+$/gm, "")
          .replace(/\n{3,}/g, "\n\n")
          .replace(/\s+$/, "");
        sToken(node, text);
      },
    ],
  ]),
  lists: new Set(),
  // Every parse error reaches the root's rule, which refuses the file rather than keep it as written.
  recovered: () => true,
  // The root prints whole, its comments with it.
  printsOwnComments: (node, ctx) => node === ctx.tree.root,
};

/** Swift as swift-format 6.3.0 prints it with its default configuration. */
const ACCESS = new Set(["public", "private", "fileprivate", "internal", "package"]);

/**
 * NoAccessLevelOnExtensionDeclaration moves an extension's access level onto its members, so in an extension an
 * access keyword does not compare where it stands: each member's first token carries the member's effective
 * access instead (its own, else the extension's, a `private` one as `fileprivate`).
 */
const normalize: Normalize = (lexemes, _text, tree) => {
  const kids = (n: number) => Array.from({ length: tree.count(n) }, (_, i) => tree.child(n, i));
  /** `decl`'s access level modifier (`private(set)` included), as swift-format's accessLevelModifier. */
  const accessModifier = (decl: number): number | undefined => {
    const modifiers = kids(decl).find((c) => tree.kindName(c) === "modifiers");
    return modifiers === undefined
      ? undefined
      : kids(modifiers).find((c) => tree.kindName(c) === "visibility_modifier" && ACCESS.has(tree.text(tree.child(c, 0))));
  };
  const accessOf = (decl: number) => {
    const m = accessModifier(decl);
    return m === undefined ? undefined : tree.text(tree.child(m, 0));
  };
  const isExtension = (n: number) =>
    n !== NO_NODE && tree.kindName(n) === "class_declaration" && kids(n).some((c) => tree.kindName(c) === "extension");
  // Each extension member's effective access, and the access modifiers that do not compare where they stand.
  const member = new Map<number, string>();
  const dropped = new Set<number>();
  for (let o = 0; o < tree.nodeCount; o++) {
    const ext = tree.at(o);
    if (!isExtension(ext)) continue;
    const own = accessOf(ext);
    const ownModifier = accessModifier(ext);
    if (ownModifier !== undefined) dropped.add(ownModifier);
    const inherited = own === "private" ? "fileprivate" : own === "internal" ? undefined : own;
    const body = kids(ext).find((c) => tree.kindName(c) === "class_body");
    if (body === undefined) continue;
    for (const m of kids(body)) {
      const k = tree.kindName(m);
      if (!k.endsWith("_declaration") || isExtension(m) || k === "protocol_declaration") continue;
      const modifier = accessModifier(m);
      if (modifier !== undefined) dropped.add(modifier);
      member.set(m, accessOf(m) ?? inherited ?? "internal");
    }
  }
  const inDropped = (n: number) => {
    for (let up = n; up !== NO_NODE; up = tree.parent(up)) if (dropped.has(up)) return true;
    return false;
  };
  /** The member whose first code token `n` is (past a dropped access keyword). */
  const leads = (n: number): number | undefined => {
    for (let up = tree.parent(n); up !== NO_NODE; up = tree.parent(up)) {
      const access = member.get(up);
      if (access === undefined) continue;
      let first = firstLeaf(tree, up);
      while (first !== NO_NODE && inDropped(first)) first = nextLeaf(tree, first);
      return first === n ? up : undefined;
    }
    return undefined;
  };
  return lexemes.map((l) => {
    if (inDropped(l.node)) return undefined;
    const m = leads(l.node);
    return m === undefined ? l.text : `${l.text}@access:${member.get(m)}`;
  });
};

export const swift: Language<SwiftOptions> = {
  ...defineLanguage(grammar, {
    parser: language,
    lineComments: { comment: "//" },
    defaults,
    settings: prettierSettings,
    normalize,
    layoutBlind: true,
  }),
  stream,
};
