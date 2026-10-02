// Writes src/grammars/<name>/highlight.gen.ts for each language in rules.node.ts: its tree-sitter highlight queries
// (the grammar package's own, in the order its tree-sitter.json lists them, then the local .scm files that extend
// them) compiled to the patterns highlight/match.ts runs, with every capture resolved to the TextMate scope the
// language's sitter-to-tm ruleset names. packages/syntechs/generate.mjs bundles this file with esbuild and runs
// it after the grammar bundles exist, since it checks every node kind a query names against the grammar.
//
// A query is rejected rather than half-compiled: an unknown node kind, a capture the ruleset does not map, or a
// predicate this compiler has no meaning for each fail the generation, naming the file and line. So does an
// injection query (injections.scm) directive it does not implement; see compileInjections.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Language } from "../core/language.js";
import { language as html } from "../grammars/html/index.js";
import { language as javascript } from "../grammars/javascript/index.js";
import { language as jsdoc } from "../grammars/jsdoc/index.js";
import { language as kotlin } from "../grammars/kotlin/index.js";
import { language as regex } from "../grammars/regex/index.js";
import { language as swift } from "../grammars/swift/index.js";
import { language as tsx } from "../grammars/tsx/index.js";
import { language as typescript } from "../grammars/typescript/index.js";
import { language as yaml } from "../grammars/yaml/index.js";
import type { CaptureScope } from "./match.js";
import { LANGUAGES, type LanguageRules, type Rule } from "./rules.node.js";

// Run as generate.mjs's bundle, dist/compiler/highlight-generate.mjs.
const pkg = resolve(import.meta.dirname, "../..");
const grammarsDir = join(pkg, "grammars");

const PARSERS: Record<string, Language> = { javascript, typescript, tsx, kotlin, swift, jsdoc, regex, html, yaml };

// ---- The query language: the subset of tree-sitter's S-expressions that highlight queries use.

interface Source {
  file: string;
  line: number;
}

type Predicate = { name: string; args: ({ capture: string } | { string: string })[]; at: Source };

interface Node {
  kind?: string;
  anon?: boolean;
  namedOnly?: boolean;
  field?: string;
  captures: string[];
  children?: Item[];
  anchorEnd?: boolean;
  alt?: Node[];
}

interface Item {
  node: Node;
  quant?: "?" | "*" | "+";
  anchored?: boolean;
}

interface Pattern {
  root: Node;
  predicates: Predicate[];
  at: Source;
}

function parseQuery(text: string, file: string): Pattern[] {
  let i = 0;
  const lineAt = (at: number) => text.slice(0, at).split("\n").length;
  const fail = (message: string): never => {
    throw new Error(`${file}:${lineAt(i)}: ${message}`);
  };
  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i] as string)) i++;
      if (text[i] !== ";") return;
      while (i < text.length && text[i] !== "\n") i++;
    }
  };
  const peek = () => {
    skip();
    return text[i];
  };
  const name = () => {
    const m = /^[A-Za-z_][\w.\-?!]*/.exec(text.slice(i));
    if (!m) fail(`expected a name, found ${JSON.stringify(text.slice(i, i + 20))}`);
    i += (m as RegExpExecArray)[0].length;
    return (m as RegExpExecArray)[0];
  };
  const string = () => {
    i++;
    let out = "";
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") {
        const e = text[i + 1];
        out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e === "0" ? "\0" : (e as string);
        i += 2;
      } else out += text[i++];
    }
    if (text[i] !== '"') fail("unterminated string");
    i++;
    return out;
  };

  let predicates: Predicate[] = [];

  /** One pattern with its quantifier and captures, or null at a predicate (collected into `predicates`). */
  const item = (): Item | Item[] | null => {
    const c = peek();
    let node: Node;
    let group: Item[] | undefined;
    if (c === "(") {
      i++;
      const d = peek();
      if (d === "#") {
        i++;
        const pname = name();
        const args: Predicate["args"] = [];
        const at = { file, line: lineAt(i) };
        while (peek() !== ")") {
          if (text[i] === "@") {
            i++;
            args.push({ capture: name() });
          } else if (text[i] === '"') args.push({ string: string() });
          else if (/[-\d]/.test(text[i] as string)) {
            // A directive's number (`#offset! @capture 0 1 0 -1`).
            const m = /^-?\d+/.exec(text.slice(i));
            if (!m) fail(`expected a number, found ${JSON.stringify(text.slice(i, i + 20))}`);
            i += (m as RegExpExecArray)[0].length;
            args.push({ string: (m as RegExpExecArray)[0] });
          } else args.push({ string: name() });
        }
        i++;
        predicates.push({ name: pname, args, at });
        return null;
      }
      if (d === "(" || d === "[" || d === '"' || d === ".") {
        // A group: a sequence of sibling patterns.
        group = sequence(")").items;
        i++;
        if (group.length !== 1) {
          const q = quantAndCaptures();
          if (q.quant || q.captures.length > 0) fail("a quantifier or capture on a multi-pattern group is not supported");
          return group;
        }
        node = (group[0] as Item).node;
      } else {
        const kind = name();
        node = { captures: [] };
        if (kind === "_") node.namedOnly = true;
        else node.kind = kind;
        const s = sequence(")");
        i++;
        if (s.items.length > 0) node.children = s.items;
        if (s.anchorEnd) node.anchorEnd = true;
      }
    } else if (c === "[") {
      i++;
      const alts: Node[] = [];
      while (peek() !== "]") {
        const it = item();
        if (it === null) continue;
        if (Array.isArray(it)) fail("a group inside an alternation is not supported");
        const one = it as Item;
        if (one.quant) fail("a quantifier inside an alternation is not supported");
        alts.push(one.node);
      }
      i++;
      node = { alt: alts, captures: [] };
    } else if (c === '"') {
      node = { kind: string(), anon: true, captures: [] };
    } else if (c === "_") {
      i++;
      node = { captures: [] };
    } else if (c === "!") {
      return fail("negated fields are not supported");
    } else {
      const field = name();
      if (peek() !== ":") fail(`expected \`:\` after field ${field}`);
      i++;
      const it = item();
      if (it === null || Array.isArray(it)) return fail(`field ${field} must name one pattern`);
      it.node.field = field;
      return it;
    }
    const q = quantAndCaptures();
    node.captures.push(...q.captures);
    return q.quant ? { node, quant: q.quant } : { node };
  };

  const quantAndCaptures = () => {
    let quant: Item["quant"];
    const captures: string[] = [];
    for (;;) {
      const c = peek();
      if (c === "?" || c === "*" || c === "+") {
        quant = c;
        i++;
      } else if (c === "@") {
        i++;
        captures.push(name());
      } else return { quant, captures };
    }
  };

  const sequence = (close: string) => {
    const items: Item[] = [];
    let anchorNext = false;
    let anchorEnd = false;
    while (peek() !== close) {
      if (i >= text.length) fail(`expected \`${close}\``);
      if (text[i] === ".") {
        i++;
        anchorNext = true;
        anchorEnd = true;
        continue;
      }
      const it = item();
      if (it === null) continue;
      const list = Array.isArray(it) ? it : [it];
      if (anchorNext && list[0]) list[0].anchored = true;
      items.push(...list);
      anchorNext = false;
      anchorEnd = false;
    }
    return { items, anchorEnd };
  };

  const out: Pattern[] = [];
  while (peek() !== undefined) {
    const at = { file, line: lineAt(i) };
    predicates = [];
    const it = item();
    if (it === null) fail("a predicate outside a pattern");
    const list = Array.isArray(it) ? it : [it as Item];
    if (list.length !== 1) fail("a top-level sequence of sibling patterns is not supported");
    const only = list[0] as Item;
    if (only.quant) fail("a quantifier on a top-level pattern is not supported");
    out.push({ root: only.node, predicates, at });
  }
  return out;
}

// ---- Query files, in tree-sitter's order.

/** A path in a grammar package's tree-sitter.json; `node_modules/<grammar>/` is the sibling grammar package. */
function packagePath(grammar: string, path: string): string {
  const m = /^node_modules\/(tree-sitter-[\w-]+)\/(.*)$/.exec(path);
  return m ? join(grammarsDir, m[1] as string, m[2] as string) : join(grammarsDir, grammar, path);
}

function queryFiles(name: string, rules: LanguageRules): string[] {
  let upstream: string[];
  if (rules.queries) upstream = rules.queries.map((q) => packagePath(rules.grammar, q));
  else {
    const config = join(grammarsDir, rules.grammar, "tree-sitter.json");
    const json = JSON.parse(readFileSync(config, "utf8")) as {
      grammars: { scope: string; highlights?: string | string[] }[];
    };
    const entry = json.grammars.find((g) => g.scope === rules.scope);
    if (!entry?.highlights) throw new Error(`${config} lists no highlights for ${rules.scope}`);
    const list = typeof entry.highlights === "string" ? [entry.highlights] : entry.highlights;
    upstream = list.map((q) => packagePath(rules.grammar, q));
  }
  const local = (rules.extend ?? []).map((f) => join(pkg, "src/grammars", f));
  const files = [...upstream, ...local];
  for (const f of files)
    if (!existsSync(f))
      throw new Error(`${name}: no highlight query at ${f} (run \`node packages/syntechs/grammars/build.mjs ${rules.grammar}\`)`);
  return files;
}

/** The grammar's injection query, found as tree-sitter finds it; undefined for a grammar with none. */
function injectionQuery(rules: LanguageRules): string | undefined {
  if (rules.injections) return packagePath(rules.grammar, rules.injections);
  const config = join(grammarsDir, rules.grammar, "tree-sitter.json");
  let listed: string | string[] | undefined;
  if (existsSync(config)) {
    const json = JSON.parse(readFileSync(config, "utf8")) as { grammars: { scope: string; injections?: string | string[] }[] };
    listed = json.grammars.find((g) => g.scope === rules.scope)?.injections;
  }
  if (Array.isArray(listed)) throw new Error(`${config}: more than one injection query for ${rules.scope} is not supported`);
  const file = packagePath(rules.grammar, listed ?? "queries/injections.scm");
  if (listed !== undefined && !existsSync(file))
    throw new Error(`no injection query at ${file} (run \`node packages/syntechs/grammars/build.mjs ${rules.grammar}\`)`);
  return existsSync(file) ? file : undefined;
}

/** A grammar's tree-sitter.json `injection-regex`, which an injection naming a language is matched against. */
function injectionRegex(rules: LanguageRules): string {
  const config = join(grammarsDir, rules.grammar, "tree-sitter.json");
  const json = JSON.parse(readFileSync(config, "utf8")) as { grammars: { scope: string; "injection-regex"?: string }[] };
  const regex = json.grammars.find((g) => g.scope === rules.scope)?.["injection-regex"];
  if (regex === undefined) throw new Error(`${config} gives ${rules.scope} no injection-regex`);
  return regex;
}

interface Emitters {
  emitNode: (n: Node, at: Source, capture: (c: string, at: Source) => number) => string;
  emitTest: (p: Pattern, capture: (c: string, at: Source) => number) => string | undefined;
  errors: string[];
  notes: string[];
}

/**
 * The `injections` field of a highlight.gen.ts. tree-sitter-highlight reads `@injection.content`, the language
 * from `@injection.language` or `#set! injection.language`, and the `#set!` flags `injection.combined` and
 * `injection.include-children`; any other directive fails the generation. A pattern without
 * `@injection.content` (an editor's convention of naming the language by the capture) injects nothing in
 * tree-sitter-highlight, so it is left out with a note.
 */
function compileInjections(name: string, rules: LanguageRules, file: string, emit: Emitters): string[] {
  const rel = relative(pkg, file);
  const patterns = parseQuery(readFileSync(file, "utf8"), rel);
  const index = new Map<string, number>();
  const capture = (c: string) => {
    let i = index.get(c);
    if (i === undefined) index.set(c, (i = index.size));
    return i;
  };
  const used = new Set<string>();
  const lines: string[] = [];
  const unusedMatch = new Set(Object.keys(rules.injectionMatch ?? {}));
  for (const p of patterns) {
    const where = `${p.at.file}:${p.at.line}`;
    const captured = new Set<string>();
    const walk = (n: Node) => {
      for (const c of n.captures) captured.add(c);
      for (const a of n.alt ?? []) walk(a);
      for (const it of n.children ?? []) walk(it.node);
    };
    walk(p.root);
    const root = emit.emitNode(p.root, p.at, capture);
    const directives = p.predicates.filter((d) => d.name.endsWith("!"));
    if (!captured.has("injection.content")) {
      emit.notes.push(`${where}: no @injection.content, so tree-sitter-highlight injects nothing here (left out)`);
      continue;
    }
    let language: string | undefined;
    const flags: string[] = [];
    for (const d of directives) {
      const args = d.args.map((a) => ("string" in a ? a.string : `@${a.capture}`));
      if (d.name === "set!" && args[0] === "injection.language" && args.length === 2) language = args[1];
      else if (d.name === "set!" && args.length === 1 && args[0] === "injection.combined") flags.push("combined: true");
      else if (d.name === "set!" && args.length === 1 && args[0] === "injection.include-children")
        flags.push("includeChildren: true");
      else emit.errors.push(`${d.at.file}:${d.at.line}: injection directive #${d.name} ${args.join(" ")} is not supported`);
    }
    const test = emit.emitTest({ ...p, predicates: p.predicates.filter((d) => !d.name.endsWith("!")) }, capture);
    let languageField: string;
    if (language !== undefined) {
      const target = LANGUAGES[language];
      if (!target || !PARSERS[language]) {
        emit.errors.push(`${where}: injects ${language}, which rules.node.ts and generate.node.ts have no grammar for`);
        continue;
      }
      used.add(language);
      languageField = JSON.stringify(language);
    } else if (captured.has("injection.language")) {
      languageField = `{ capture: ${capture("injection.language")} }`;
    } else {
      emit.errors.push(`${where}: an injection with neither @injection.language nor #set! injection.language`);
      continue;
    }
    const parts = [`root: ${root}`, `language: ${languageField}`, `content: ${capture("injection.content")}`, ...flags];
    const match = language === undefined ? undefined : rules.injectionMatch?.[language];
    if (match !== undefined) {
      unusedMatch.delete(language as string);
      parts.push(`contentMatch: /${match}/`);
    }
    if (test) parts.push(`test: ${test}`);
    lines.push(`      // ${where}`, `      { ${parts.join(", ")} },`);
  }
  for (const m of unusedMatch) emit.errors.push(`rules.node.ts: injectionMatch names ${m}, which ${name} never injects`);
  if (lines.length === 0) return [];
  if (used.size > 0)
    emit.notes.push(
      `A language named by @injection.language resolves only to these, by their injection-regex: ${[...used].join(", ")}`,
    );
  const languages = [...used].map((l) => {
    const target = LANGUAGES[l] as LanguageRules;
    return [
      `      ${l}: {`,
      `        regex: /${injectionRegex(target)}/,`,
      `        load: async () => ({`,
      `          language: (await import("../${l}/index.js")).language,`,
      `          highlight: (await import("../${l}/highlight.gen.js")).highlight,`,
      "        }),",
      "      },",
    ].join("\n");
  });
  return ["  injections: {", "    patterns: [", ...lines, "    ],", "    languages: {", ...languages, "    },", "  },"];
}

// ---- Compiling.

function resolveRule(rule: Rule): CaptureScope {
  return typeof rule === "string" ? { scope: rule } : rule;
}

function compile(name: string, rules: LanguageRules, language: Language): string {
  const files = queryFiles(name, rules);
  const patterns = files.flatMap((f) => parseQuery(readFileSync(f, "utf8"), relative(pkg, f)));
  const symbols = new Set(language.symbolNames);
  const errors: string[] = [];
  const notes: string[] = [];
  const captureIndex = new Map<string, number>();
  const captures: (CaptureScope | null)[] = [];
  const hostCapture = (c: string, at: Source): number => {
    let index = captureIndex.get(c);
    if (index !== undefined) return index;
    let scope: CaptureScope | null;
    if (c.startsWith("_")) scope = null;
    else if (c === "none") scope = { scope: "" };
    else {
      const rule = rules.captures[c];
      if (rule === undefined) {
        errors.push(`${at.file}:${at.line}: capture @${c} has no scope in rules.node.ts (${name})`);
        scope = null;
      } else scope = rule === null ? null : resolveRule(rule);
    }
    index = captures.length;
    captures.push(scope);
    captureIndex.set(c, index);
    return index;
  };

  type CaptureFn = (c: string, at: Source) => number;
  const emitNode = (n: Node, at: Source, capture: CaptureFn = hostCapture): string => {
    if (n.kind !== undefined && !symbols.has(n.kind))
      errors.push(`${at.file}:${at.line}: ${n.anon ? JSON.stringify(n.kind) : `(${n.kind})`} is not a node kind of ${name}`);
    const parts: string[] = [];
    if (n.kind !== undefined) parts.push(`kind: ${JSON.stringify(n.kind)}`);
    if (n.anon) parts.push("anon: true");
    if (n.namedOnly) parts.push("namedOnly: true");
    if (n.field !== undefined) {
      if (!language.fieldNames.includes(n.field)) errors.push(`${at.file}:${at.line}: ${n.field} is not a field of ${name}`);
      parts.push(`field: ${JSON.stringify(n.field)}`);
    }
    if (n.captures.length > 0) parts.push(`captures: [${n.captures.map((c) => capture(c, at)).join(", ")}]`);
    if (n.alt) parts.push(`alt: [${n.alt.map((a) => emitNode(a, at, capture)).join(", ")}]`);
    if (n.children) {
      const items = n.children.map((it) => {
        const p = [`node: ${emitNode(it.node, at, capture)}`];
        if (it.quant) p.push(`quant: ${JSON.stringify(it.quant)}`);
        if (it.anchored) p.push("anchored: true");
        return `{ ${p.join(", ")} }`;
      });
      parts.push(`children: [${items.join(", ")}]`);
    }
    if (n.anchorEnd) parts.push("anchorEnd: true");
    return `{ ${parts.join(", ")} }`;
  };

  const emitTest = (p: Pattern, capture: CaptureFn = hostCapture): string | undefined => {
    const checks: string[] = [];
    for (const pred of p.predicates) {
      const where = `${pred.at.file}:${pred.at.line}`;
      const [first, ...rest] = pred.args;
      const negate = pred.name.startsWith("not-");
      const base = negate ? pred.name.slice(4) : pred.name;
      if (base === "is-not?" || base === "is?") {
        // `local`: whether the identifier is a binding locals.scm finds; syntechs runs no locals query, so a
        // highlight it guards always applies.
        if (pred.name === "is-not?" && first && "string" in first && first.string === "local") {
          notes.push(`${where}: (#is-not? local) always holds (no locals query)`);
          continue;
        }
        errors.push(`${where}: predicate #${pred.name} ${JSON.stringify(pred.args)} is not supported`);
        continue;
      }
      if (!first || !("capture" in first)) {
        errors.push(`${where}: #${pred.name} must start with a capture`);
        continue;
      }
      const texts = `t(${capture(first.capture, pred.at)})`;
      let check: string;
      if (base === "eq?" && rest.length === 1) {
        const arg = rest[0] as Predicate["args"][number];
        check =
          "capture" in arg
            ? `${texts}.every((s, i) => s === t(${capture(arg.capture, pred.at)})[i])`
            : `${texts}.every((s) => s === ${JSON.stringify(arg.string)})`;
      } else if (base === "match?" && rest.length === 1 && "string" in (rest[0] as object)) {
        const source = (rest[0] as { string: string }).string;
        try {
          new RegExp(source);
        } catch (e) {
          errors.push(`${where}: #${pred.name} ${JSON.stringify(source)} is not a JS regular expression: ${(e as Error).message}`);
          continue;
        }
        check = `${texts}.every((s) => /${source.replace(/\//g, "\\/")}/.test(s))`;
      } else if (base === "any-of?" && rest.every((a) => "string" in a)) {
        check = `${texts}.every((s) => ${JSON.stringify(rest.map((a) => (a as { string: string }).string))}.includes(s))`;
      } else {
        errors.push(`${where}: predicate #${pred.name} ${JSON.stringify(pred.args)} is not supported`);
        continue;
      }
      checks.push(negate ? `!(${check})` : check);
    }
    return checks.length > 0 ? `(t) => ${checks.join(" && ")}` : undefined;
  };

  const lines: string[] = [];
  for (const p of patterns) {
    const root = emitNode(p.root, p.at);
    const test = emitTest(p);
    lines.push(`    // ${p.at.file}:${p.at.line}`);
    lines.push(`    { root: ${root}${test ? `, test: ${test}` : ""} },`);
  }
  const injectionFile = injectionQuery(rules);
  const injectionLines = injectionFile
    ? compileInjections(name, rules, injectionFile, { emitNode, emitTest, errors, notes })
    : [];
  if (!injectionFile && rules.injectionMatch)
    errors.push(`rules.node.ts: ${name} has an injectionMatch but no injection query was found`);
  if (errors.length > 0) throw new Error(`highlight queries for ${name}:\n  ${errors.join("\n  ")}`);
  const captureLines = [...captureIndex].map(
    ([c, i]) => `    ${JSON.stringify(captures[i])}, // ${i}: @${c}`,
  );
  return [
    `// Generated by src/highlight/generate.node.ts from ${[...files, ...(injectionFile ? [injectionFile] : [])].map((f) => relative(pkg, f)).join(", ")}; do not edit.`,
    "// Change a capture's scope in src/highlight/rules.node.ts, or a pattern in the query files.",
    ...notes.map((n) => `// ${n}`),
    "",
    `import { queryHighlighter } from "../../highlight/match.js";`,
    "",
    "export const highlight = queryHighlighter({",
    "  captures: [",
    ...captureLines,
    "  ],",
    "  patterns: [",
    ...lines,
    "  ],",
    ...injectionLines,
    "});",
    "",
  ].join("\n");
}

for (const [name, rules] of Object.entries(LANGUAGES)) {
  const language = PARSERS[name];
  if (!language) throw new Error(`rules.node.ts names ${name}, which generate.node.ts has no parser for`);
  const out = join(pkg, "src", "grammars", name, "highlight.gen.ts");
  writeFileSync(out, compile(name, rules, language));
  console.log(`wrote ${out}`);
}

