// Spike "compiler": turns a tree-sitter generated src/parser.c into a TS module of typed-array
// tables plus the lexer translated from ts_lex's C control flow.
// Usage: node gen.ts <path/to/parser.c> <out.ts>
// Handles what tree-sitter-json's parser.c uses. Fails loudly on constructs it does not know:
// external scanners, keyword lexing, set_contains character sets, alias sequences, reserved words.
import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) throw new Error("usage: node gen.ts <parser.c> <out.ts>");
const c = readFileSync(inPath, "utf8").replace(/\r\n/g, "\n");

const define = (name: string): number => {
  const m = c.match(new RegExp(`#define ${name} (\\d+)`));
  if (!m) throw new Error(`missing #define ${name}`);
  return Number(m[1]);
};
const block = (header: string): string => {
  const i = c.indexOf(header);
  if (i < 0) throw new Error(`missing block: ${header}`);
  const open = c.indexOf("{", i + header.length - 1);
  let depth = 0;
  for (let j = open; j < c.length; j++) {
    if (c[j] === "{") depth++;
    else if (c[j] === "}" && --depth === 0) return c.slice(open + 1, j);
  }
  throw new Error(`unterminated block: ${header}`);
};

const unsupported = ["EXTERNAL_TOKEN_COUNT [1-9]", "ts_lex_keywords", "set_contains", "ts_external_scanner", "ALIAS_COUNT [1-9]"];
for (const u of unsupported) if (new RegExp(u).test(c)) throw new Error(`spike does not support: ${u}`);

const SYMBOL_COUNT = define("SYMBOL_COUNT");
const TOKEN_COUNT = define("TOKEN_COUNT");
const STATE_COUNT = define("STATE_COUNT");
const LARGE_STATE_COUNT = define("LARGE_STATE_COUNT");
const LANGUAGE_VERSION = define("LANGUAGE_VERSION");

// Symbol ids
const sym = new Map<string, number>([["ts_builtin_sym_end", 0]]);
for (const m of block("enum ts_symbol_identifiers {").matchAll(/(\w+) = (\d+)/g)) sym.set(m[1], Number(m[2]));
const symId = (s: string): number => {
  const v = sym.get(s.trim());
  if (v === undefined) throw new Error(`unknown symbol ${s}`);
  return v;
};

const names: string[] = new Array(SYMBOL_COUNT).fill("");
for (const m of block("ts_symbol_names[] = {").matchAll(/\[(\w+)\] = ("(?:[^"\\]|\\.)*")/g)) names[symId(m[1])] = JSON.parse(m[2]);

const visible = new Uint8Array(SYMBOL_COUNT);
const named = new Uint8Array(SYMBOL_COUNT);
for (const m of block("ts_symbol_metadata[] = {").matchAll(/\[(\w+)\] = \{([^}]*)\}/g)) {
  const id = symId(m[1]);
  visible[id] = /\.visible = true/.test(m[2]) ? 1 : 0;
  named[id] = /\.named = true/.test(m[2]) ? 1 : 0;
}

// Large parse table: dense [LARGE_STATE_COUNT][SYMBOL_COUNT]
const parseTable = new Uint16Array(LARGE_STATE_COUNT * SYMBOL_COUNT);
{
  const body = block("ts_parse_table[LARGE_STATE_COUNT][SYMBOL_COUNT] = {");
  for (const st of body.matchAll(/\[(\d+)\] = \{([^}]*)\}/g)) {
    const s = Number(st[1]);
    for (const e of st[2].matchAll(/\[(\w+)\] = (?:ACTIONS|STATE)\((\d+)\)/g)) parseTable[s * SYMBOL_COUNT + symId(e[1])] = Number(e[2]);
  }
}

// Small parse table: groups of (value, symbolCount, symbols...)
const smallTable: number[] = [];
for (const raw of block("ts_small_parse_table[] = {").replace(/\[\d+\] =/g, "").split(",")) {
  const t = raw.trim();
  if (!t) continue;
  const m = t.match(/^(?:ACTIONS|STATE)\((\d+)\)$/);
  smallTable.push(m ? Number(m[1]) : /^\d+$/.test(t) ? Number(t) : symId(t));
}
const smallMap: number[] = [];
for (const m of block("ts_small_parse_table_map[] = {").matchAll(/\[SMALL_STATE\((\d+)\)\] = (\d+)/g)) {
  smallMap[Number(m[1]) - LARGE_STATE_COUNT] = Number(m[2]);
}

// Parse actions. Layout per action slot i: kind, a, b, c
//   shift: a=state, b=flags (1 extra, 2 repetition); reduce: a=symbol, b=childCount, c=productionId
const SHIFT = 1, REDUCE = 2, ACCEPT = 3, RECOVER = 4;
const actions: number[][] = [];
const entryCount: number[] = [];
for (const line of block("ts_parse_actions[] = {").split("\n")) {
  const m = line.match(/\[(\d+)\] = \{\.entry = \{\.count = (\d+), \.reusable = \w+\}\},(.*)$/);
  if (!m) continue;
  const at = Number(m[1]);
  entryCount[at] = Number(m[2]);
  let slot = at + 1;
  for (const a of m[3].matchAll(/(SHIFT_REPEAT|SHIFT_EXTRA|SHIFT|REDUCE|ACCEPT_INPUT|RECOVER)\(([^)]*)\)/g)) {
    const args = a[2].split(",").map((x) => x.trim());
    if (a[1] === "SHIFT") actions[slot] = [SHIFT, Number(args[0]), 0, 0];
    else if (a[1] === "SHIFT_REPEAT") actions[slot] = [SHIFT, Number(args[0]), 2, 0];
    else if (a[1] === "SHIFT_EXTRA") actions[slot] = [SHIFT, 0, 1, 0];
    else if (a[1] === "REDUCE") actions[slot] = [REDUCE, symId(args[0]), Number(args[1]), Number(args[3])];
    else if (a[1] === "ACCEPT_INPUT") actions[slot] = [ACCEPT, 0, 0, 0];
    else actions[slot] = [RECOVER, 0, 0, 0];
    slot++;
  }
}
const actionLen = actions.length;
const act = new Int32Array(actionLen * 4);
const count = new Uint8Array(actionLen);
actions.forEach((a, i) => a && act.set(a, i * 4));
entryCount.forEach((n, i) => n !== undefined && (count[i] = n));

const lexModes = new Uint16Array(STATE_COUNT);
for (const m of block("ts_lex_modes[STATE_COUNT] = {").matchAll(/\[(\d+)\] = \{\.lex_state = (\d+)\}/g)) lexModes[Number(m[1])] = Number(m[2]);

// ---- lexer: translate the generated C control flow -----------------------------------------
const CHAR_ESC: Record<string, number> = { t: 9, n: 10, r: 13, "\\": 92, "'": 39, '"': 34, "0": 0, v: 11, f: 12, b: 8 };
const charCode = (lit: string): number => {
  const body = lit.slice(1, -1);
  if (body.length === 1) return body.codePointAt(0)!;
  if (body[0] === "\\" && body.length === 2 && body[1] in CHAR_ESC) return CHAR_ESC[body[1]];
  throw new Error(`unknown char literal ${lit}`);
};
let lexBody = block("static bool ts_lex(TSLexer *lexer, TSStateId state) {");
lexBody = lexBody
  .replace(/'(\\.|[^'\\])'/g, (lit) => String(charCode(lit)))
  .replace(/START_LEXER\(\);/, "")
  .replace(/eof = lexer->eof\(lexer\);/, "")
  .replace(/ADVANCE_MAP\(([^)]*)\);/g, (_, args: string) => {
    const xs = args.split(",").map((x) => x.trim()).filter(Boolean);
    let out = "switch (lookahead) {";
    for (let i = 0; i < xs.length; i += 2) out += ` case ${xs[i]}: state = ${xs[i + 1]}; continue;`;
    return `${out} }`;
  })
  .replace(/ADVANCE\((\d+)\);/g, "{ state = $1; continue; }")
  .replace(/SKIP\((\d+)\);/g, "{ skip = true; state = $1; continue; }")
  .replace(/ACCEPT_TOKEN\((\w+)\);/g, (_, s: string) => `result = true; L.resultSymbol = ${symId(s)}; L.tokenEnd = L.pos;`)
  .replace(/END_STATE\(\);/g, "return result;");
if (/lexer->|[A-Z_]{4,}\(/.test(lexBody)) throw new Error(`untranslated lexer construct: ${lexBody.match(/.*(lexer->|[A-Z_]{4,}\().*/)?.[0]}`);

const arr = (name: string, a: ArrayLike<number>) => `export const ${name} = ${a.constructor.name === "Array" ? "" : `new ${a.constructor.name}(`}[${Array.from(a).join(",")}]${a.constructor.name === "Array" ? "" : ")"};`;
const out = `// GENERATED by research/ts-sitter-spike/gen.ts from ${inPath.replace(/\\/g, "/").split("/node_modules/").pop()}. Do not edit.
import type { Lexer } from "./runtime.ts";
export const LANGUAGE_VERSION = ${LANGUAGE_VERSION};
export const SYMBOL_COUNT = ${SYMBOL_COUNT};
export const TOKEN_COUNT = ${TOKEN_COUNT};
export const STATE_COUNT = ${STATE_COUNT};
export const LARGE_STATE_COUNT = ${LARGE_STATE_COUNT};
export const symbolNames: string[] = ${JSON.stringify(names)};
${arr("visible", visible)}
${arr("named", named)}
${arr("parseTable", parseTable)}
${arr("smallTable", Uint16Array.from(smallTable))}
${arr("smallMap", Uint32Array.from(smallMap))}
${arr("actions", act)}
${arr("actionCount", count)}
${arr("lexModes", lexModes)}
export function lex(L: Lexer, state: number): boolean {
  let result = false, skip = false, first = true;
  for (;;) {
    if (first) first = false; else L.advance(skip);
    skip = false;
    const lookahead = L.lookahead;
    const eof = L.pos >= L.end;
${lexBody}
  }
}
`;
writeFileSync(outPath, out);
console.log(`wrote ${outPath}: ${SYMBOL_COUNT} symbols, ${STATE_COUNT} states, ${actionLen} action slots`);
