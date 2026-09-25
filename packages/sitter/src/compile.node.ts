// Table compiler: turns a grammar's generated src/parser.c into src/generated/<name>.ts, the numeric tables
// varint+base64 encoded for `loadLanguage` and the two lexer functions translated from their C control flow.
// Run after `pnpm typecheck`: node packages/sitter/dist/compile.node.js [grammar...]
// It fails loudly on any parser.c construct it does not translate, rather than emitting a wrong table.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTION_ACCEPT,
  ACTION_HEADER,
  ACTION_RECOVER,
  ACTION_REDUCE,
  ACTION_SHIFT,
  FLAG_NAMED,
  FLAG_SUPERTYPE,
  FLAG_VISIBLE,
} from "./language.js";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
export const GRAMMARS: Record<string, { src: string; scanner?: string }> = {
  json: { src: "tree-sitter-json/src" },
  css: { src: "tree-sitter-css/src", scanner: "css" },
  javascript: { src: "tree-sitter-javascript/src", scanner: "javascript" },
  typescript: {
    src: "tree-sitter-typescript/typescript/src",
    scanner: "typescript",
  },
  // Both dialects include the same common/scanner.h.
  tsx: { src: "tree-sitter-typescript/tsx/src", scanner: "typescript" },
  python: { src: "tree-sitter-python/src", scanner: "python" },
};

function compile(
  name: string,
  src: string,
  scanner: string | undefined,
): string {
  const c = readFileSync(
    join(pkg, "node_modules", src, "parser.c"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  const define = (key: string, fallback?: number): number => {
    const m = c.match(new RegExp(`#define ${key} (\\d+)`));
    if (m) return Number(m[1]);
    if (fallback === undefined)
      throw new Error(`${name}: missing #define ${key}`);
    return fallback;
  };
  const block = (header: RegExp, optional = false): string | undefined => {
    const m = header.exec(c);
    if (!m) {
      if (optional) return undefined;
      throw new Error(`${name}: missing block ${header}`);
    }
    const open = m.index + m[0].length - 1;
    if (c[open] !== "{")
      throw new Error(`${name}: block header ${header} must end at its brace`);
    let depth = 0;
    for (let j = open; j < c.length; j++) {
      if (c[j] === "'" || c[j] === '"') {
        const q = c[j];
        for (j++; c[j] !== q; j++) if (c[j] === "\\") j++;
      } else if (c[j] === "{") depth++;
      else if (c[j] === "}" && --depth === 0) return c.slice(open + 1, j);
    }
    throw new Error(`${name}: unterminated block ${header}`);
  };
  const need = (s: string | undefined): string => s ?? "";

  const abi = define("LANGUAGE_VERSION");
  const symbolCount = define("SYMBOL_COUNT");
  const aliasCount = define("ALIAS_COUNT");
  const tokenCount = define("TOKEN_COUNT");
  const externalTokenCount = define("EXTERNAL_TOKEN_COUNT");
  const stateCount = define("STATE_COUNT");
  const largeStateCount = define("LARGE_STATE_COUNT");
  const productionIdCount = define("PRODUCTION_ID_COUNT");
  const fieldCount = define("FIELD_COUNT");
  const maxAliasSequenceLength = define("MAX_ALIAS_SEQUENCE_LENGTH");
  const maxReservedWordSetSize = define("MAX_RESERVED_WORD_SET_SIZE", 0);
  const total = symbolCount + aliasCount;

  const ids = new Map<string, number>([["ts_builtin_sym_end", 0]]);
  for (const m of need(block(/enum ts_symbol_identifiers \{/)).matchAll(
    /(\w+) = (\d+)/g,
  ))
    ids.set(m[1] as string, Number(m[2]));
  for (const m of need(block(/enum ts_field_identifiers \{/, true)).matchAll(
    /(\w+) = (\d+)/g,
  ))
    ids.set(m[1] as string, Number(m[2]));
  for (const m of need(
    block(/enum ts_external_scanner_symbol_identifiers \{/, true),
  ).matchAll(/(\w+) = (\d+)/g))
    ids.set(m[1] as string, Number(m[2]));
  const id = (raw: string): number => {
    const t = raw.trim();
    if (/^-?\d+$/.test(t)) return Number(t);
    const v = ids.get(t);
    if (v === undefined) throw new Error(`${name}: unknown identifier ${t}`);
    return v;
  };

  const symbolNames: string[] = new Array(total).fill("");
  for (const m of need(block(/ts_symbol_names\[\] = \{/)).matchAll(
    /\[(\w+)\] = ("(?:[^"\\]|\\.)*")/g,
  ))
    symbolNames[id(m[1] as string)] = cString(m[2] as string);

  const publicMap: number[] = new Array(total).fill(0);
  for (const m of need(block(/ts_symbol_map\[\] = \{/)).matchAll(
    /\[(\w+)\] = (\w+)/g,
  ))
    publicMap[id(m[1] as string)] = id(m[2] as string);

  const flags: number[] = new Array(total).fill(0);
  for (const m of need(block(/ts_symbol_metadata\[\] = \{/)).matchAll(
    /\[(\w+)\] = \{([^}]*)\}/g,
  )) {
    const body = m[2] as string;
    flags[id(m[1] as string)] =
      (/\.visible = true/.test(body) ? FLAG_VISIBLE : 0) |
      (/\.named = true/.test(body) ? FLAG_NAMED : 0) |
      (/\.supertype = true/.test(body) ? FLAG_SUPERTYPE : 0);
  }

  const fieldNames: string[] = new Array(fieldCount + 1).fill("");
  for (const m of need(
    block(/ts_field_names\[\] = \{/, fieldCount === 0),
  ).matchAll(/\[(\w+)\] = ("(?:[^"\\]|\\.)*")/g))
    fieldNames[id(m[1] as string)] = cString(m[2] as string);

  // ---- parse tables ----
  const large: number[][] = [];
  for (const st of need(
    block(/ts_parse_table\[LARGE_STATE_COUNT\]\[SYMBOL_COUNT\] = \{/),
  ).matchAll(/\[(?:STATE\()?(\d+)\)?\] = \{([^}]*)\}/g)) {
    const row: number[] = [];
    for (const e of (st[2] as string).matchAll(
      /\[(\w+)\] = (?:ACTIONS|STATE)\((\d+)\)/g,
    ))
      row.push(id(e[1] as string), Number(e[2]));
    large[Number(st[1])] = row;
  }
  const small: number[] = [];
  for (const raw of need(block(/ts_small_parse_table\[\] = \{/))
    .replace(/\[\d+\] =/g, "")
    .split(",")) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^(?:ACTIONS|STATE)\((\d+)\)$/);
    small.push(m ? Number(m[1]) : id(t));
  }
  const smallMap: number[] = new Array(stateCount - largeStateCount).fill(0);
  for (const m of need(block(/ts_small_parse_table_map\[\] = \{/)).matchAll(
    /\[SMALL_STATE\((\d+)\)\] = (\d+)/g,
  ))
    smallMap[Number(m[1]) - largeStateCount] = Number(m[2]);

  // Each slot: [type, ...fields] as loadLanguage reads them.
  const slots: number[][] = [];
  for (const line of need(block(/ts_parse_actions\[\] = \{/)).split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(
      /^\s*\[(\d+)\] = \{\.entry = \{\.count = (\d+), \.reusable = (true|false)\}\},(.*)$/,
    );
    if (!m) throw new Error(`${name}: unparsed action line ${line}`);
    let slot = Number(m[1]);
    slots[slot++] = [ACTION_HEADER, Number(m[2]), m[3] === "true" ? 1 : 0];
    let n = 0;
    for (const a of (m[4] as string).matchAll(
      /(SHIFT_REPEAT|SHIFT_EXTRA|SHIFT|REDUCE|ACCEPT_INPUT|RECOVER)\(([^)]*)\)/g,
    )) {
      const args = (a[2] as string).split(",").map((x) => x.trim());
      const kind = a[1];
      if (kind === "SHIFT") slots[slot] = [ACTION_SHIFT, Number(args[0]), 0];
      else if (kind === "SHIFT_REPEAT")
        slots[slot] = [ACTION_SHIFT, Number(args[0]), 2];
      else if (kind === "SHIFT_EXTRA") slots[slot] = [ACTION_SHIFT, 0, 1];
      else if (kind === "REDUCE")
        slots[slot] = [
          ACTION_REDUCE,
          id(args[0] as string),
          Number(args[1]),
          Number(args[2]),
          Number(args[3]),
        ];
      else if (kind === "ACCEPT_INPUT") slots[slot] = [ACTION_ACCEPT];
      else slots[slot] = [ACTION_RECOVER];
      slot++;
      n++;
    }
    if (n !== Number(m[2]))
      throw new Error(
        `${name}: action entry ${m[1]} declares ${m[2]} actions, parsed ${n}`,
      );
  }
  for (let i = 0; i < slots.length; i++)
    if (!slots[i]) throw new Error(`${name}: action slot ${i} is empty`);

  // ---- fields, aliases ----
  const sliceIndex: number[] = new Array(productionIdCount).fill(0);
  const sliceLength: number[] = new Array(productionIdCount).fill(0);
  for (const m of need(
    block(/ts_field_map_slices\[PRODUCTION_ID_COUNT\] = \{/, fieldCount === 0),
  ).matchAll(/\[(\d+)\] = \{\.index = (\d+), \.length = (\d+)\}/g)) {
    sliceIndex[Number(m[1])] = Number(m[2]);
    sliceLength[Number(m[1])] = Number(m[3]);
  }
  const fieldEntries: number[][] = [];
  {
    let at = 0;
    for (const m of need(
      block(/ts_field_map_entries\[\] = \{/, fieldCount === 0),
    ).matchAll(/\[(\d+)\] =|\{([^}]*)\}/g)) {
      if (m[1] !== undefined) {
        at = Number(m[1]);
        continue;
      }
      const e = (m[2] as string).match(/^(\w+), (\d+)(, \.inherited = true)?$/);
      if (!e) throw new Error(`${name}: unparsed field entry {${m[2]}}`);
      fieldEntries[at++] = [id(e[1] as string), Number(e[2]), e[3] ? 1 : 0];
    }
  }
  const aliases: number[] = new Array(
    productionIdCount * maxAliasSequenceLength,
  ).fill(0);
  for (const m of need(
    block(
      /ts_alias_sequences\[PRODUCTION_ID_COUNT\]\[MAX_ALIAS_SEQUENCE_LENGTH\] = \{/,
    ),
  ).matchAll(/\[(\d+)\] = \{([^}]*)\}/g)) {
    for (const e of (m[2] as string).matchAll(/\[(\d+)\] = (\w+)/g))
      aliases[Number(m[1]) * maxAliasSequenceLength + Number(e[1])] = id(
        e[2] as string,
      );
  }

  // ---- lex modes, reserved words, externals ----
  const lexState: number[] = new Array(stateCount).fill(0);
  const externalLexState: number[] = new Array(stateCount).fill(0);
  const reservedSet: number[] = new Array(stateCount).fill(0);
  for (const m of need(block(/ts_lex_modes\[STATE_COUNT\] = \{/)).matchAll(
    /\[(\d+)\] = \{([^}]*)\}/g,
  )) {
    const s = Number(m[1]);
    const body = m[2] as string;
    for (const f of body.matchAll(/\.(\w+) = ([^,]+)/g)) {
      const v =
        (f[2] as string).trim() === "(TSStateId)(-1)" ? 65535 : Number(f[2]);
      if (Number.isNaN(v))
        throw new Error(`${name}: unparsed lex mode ${body}`);
      if (f[1] === "lex_state") lexState[s] = v;
      else if (f[1] === "external_lex_state") externalLexState[s] = v;
      else if (f[1] === "reserved_word_set_id") reservedSet[s] = v;
      else throw new Error(`${name}: unknown lex mode field ${f[1]}`);
    }
  }
  const reservedWords: number[] = [];
  const rw = block(
    /ts_reserved_words\[\d+\]\[MAX_RESERVED_WORD_SET_SIZE\] = \{/,
    true,
  );
  if (rw) {
    const sets = Number(c.match(/ts_reserved_words\[(\d+)\]/)?.[1]);
    reservedWords.push(...new Array(sets * maxReservedWordSetSize).fill(0));
    for (const m of rw.matchAll(/\[(\d+)\] = \{([^}]*)\}/g)) {
      const words = (m[2] as string)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      words.forEach((w, i) => {
        reservedWords[Number(m[1]) * maxReservedWordSetSize + i] = id(w);
      });
    }
  }
  const externalSymbolMap: number[] = new Array(externalTokenCount).fill(0);
  const externalStates: number[] = [];
  if (externalTokenCount > 0) {
    for (const m of need(
      block(/ts_external_scanner_symbol_map\[EXTERNAL_TOKEN_COUNT\] = \{/),
    ).matchAll(/\[(\w+)\] = (\w+)/g))
      externalSymbolMap[id(m[1] as string)] = id(m[2] as string);
    const states = Number(c.match(/ts_external_scanner_states\[(\d+)\]/)?.[1]);
    externalStates.push(...new Array(states * externalTokenCount).fill(0));
    for (const m of need(
      block(/ts_external_scanner_states\[\d+\]\[EXTERNAL_TOKEN_COUNT\] = \{/),
    ).matchAll(/\[(\d+)\] = \{([^}]*)\}/g)) {
      for (const e of (m[2] as string).matchAll(/\[(\w+)\] = true/g))
        externalStates[Number(m[1]) * externalTokenCount + id(e[1] as string)] =
          1;
    }
  }
  const kw = c.match(/\.keyword_capture_token = (\w+)/);
  const keywordCaptureToken = kw ? id(kw[1] as string) : 0;

  // ---- encode ----
  const bytes: number[] = [];
  const uint = (v: number) => {
    if (!Number.isInteger(v) || v < 0)
      throw new Error(`${name}: cannot encode ${v}`);
    let x = v;
    while (x >= 128) {
      bytes.push((x % 128) | 128);
      x = Math.floor(x / 128);
    }
    bytes.push(x);
  };
  const int = (v: number) => uint(v < 0 ? -2 * v - 1 : 2 * v);
  const list = (xs: number[], withLength: boolean) => {
    if (withLength) uint(xs.length);
    for (const x of xs) uint(x);
  };
  list(flags, false);
  list(publicMap, false);
  for (let s = 0; s < largeStateCount; s++) {
    const row = large[s] ?? [];
    const pairs: [number, number][] = [];
    for (let i = 0; i < row.length; i += 2)
      pairs.push([row[i] as number, row[i + 1] as number]);
    pairs.sort((a, b) => a[0] - b[0]);
    uint(pairs.length);
    let prev = 0;
    for (const [sym, value] of pairs) {
      uint(sym - prev);
      uint(value);
      prev = sym;
    }
  }
  list(small, true);
  list(smallMap, false);
  uint(slots.length);
  for (const s of slots as number[][]) {
    uint(s[0] as number);
    if (s[0] === ACTION_HEADER || s[0] === ACTION_SHIFT) {
      uint(s[1] as number);
      uint(s[2] as number);
    } else if (s[0] === ACTION_REDUCE) {
      uint(s[1] as number);
      uint(s[2] as number);
      int(s[3] as number);
      uint(s[4] as number);
    }
  }
  for (let p = 0; p < productionIdCount; p++) {
    uint(sliceIndex[p] as number);
    uint(sliceLength[p] as number);
  }
  uint(fieldEntries.length);
  for (let i = 0; i < fieldEntries.length; i++) {
    const e = fieldEntries[i];
    if (!e) throw new Error(`${name}: field entry ${i} is empty`);
    for (const x of e) uint(x);
  }
  list(aliases, false);
  list(lexState, false);
  list(externalLexState, false);
  list(reservedSet, false);
  list(reservedWords, true);
  list(externalSymbolMap, false);
  list(externalStates, true);
  const data = Buffer.from(bytes).toString("base64");

  // ---- lexers ----
  const sets: string[] = [];
  for (const m of c.matchAll(
    /static (?:const )?TSCharacterRange (\w+)\[\] = \{([^;]*)\};/g,
  )) {
    const pairs: number[] = [];
    for (const p of (m[2] as string).matchAll(/\{([^,}]+), ([^}]+)\}/g))
      pairs.push(charValue(p[1] as string), charValue(p[2] as string));
    sets.push(`const ${m[1]} = new Int32Array([${pairs.join(",")}]);`);
  }
  const lexFn = translateLexer(
    name,
    need(block(/static bool ts_lex\(TSLexer \*lexer, TSStateId state\) \{/)),
    id,
  );
  const kwBody = block(
    /static bool ts_lex_keywords\(TSLexer \*lexer, TSStateId state\) \{/,
    true,
  );
  const kwFn = kwBody ? translateLexer(name, kwBody, id) : undefined;

  const meta = {
    name,
    abi,
    symbolCount,
    aliasCount,
    tokenCount,
    externalTokenCount,
    stateCount,
    largeStateCount,
    productionIdCount,
    fieldCount,
    maxAliasSequenceLength,
    maxReservedWordSetSize,
    keywordCaptureToken,
    symbolNames,
    fieldNames,
  };
  const metaJson = JSON.stringify(meta).slice(0, -1);
  return `// GENERATED by packages/sitter/src/compile.node.ts from ${src}/parser.c. Do not edit.
import { type Language, loadLanguage, setContains } from "../language.js";
import type { Lexer } from "../lexer.js";
${scanner ? `import { createScanner } from "../scanners/${scanner}.js";\n` : ""}
${sets.join("\n")}

function lex(lexer: Lexer, state: number): boolean {
${lexFn}
}
${kwFn ? `\nfunction keywordLex(lexer: Lexer, state: number): boolean {\n${kwFn}\n}\n` : ""}
export const language: Language = loadLanguage(${metaJson},"data":"${data}"}, lex, ${kwFn ? "keywordLex" : "undefined"}, ${scanner ? "createScanner" : "undefined"});
`;
}

const CHAR_ESC: Record<string, number> = {
  t: 9,
  n: 10,
  r: 13,
  "\\": 92,
  "'": 39,
  '"': 34,
  "?": 63,
  "0": 0,
  v: 11,
  f: 12,
  b: 8,
  a: 7,
};

/** A C string literal (quotes included) as the UTF-8 text it spells. */
function cString(lit: string): string {
  const bytes: number[] = [];
  const body = lit.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch));
      continue;
    }
    const e = body[++i] as string;
    if (e === "x") {
      const hex = (
        body.slice(i + 1).match(/^[0-9a-fA-F]+/) as RegExpMatchArray
      )[0];
      bytes.push(Number.parseInt(hex, 16));
      i += hex.length;
    } else if (e in CHAR_ESC) bytes.push(CHAR_ESC[e] as number);
    else throw new Error(`unknown string escape \\${e} in ${lit}`);
  }
  return Buffer.from(bytes).toString("utf8");
}
function charValue(lit: string): number {
  const t = lit.trim();
  if (/^(0x[0-9a-fA-F]+|\d+)$/.test(t)) return Number(t);
  const body = t.slice(1, -1);
  if (t[0] !== "'" || t.at(-1) !== "'")
    throw new Error(`unknown char literal ${t}`);
  if (body.length === 1) return body.codePointAt(0) as number;
  if (body[0] === "\\" && body.length === 2 && (body[1] as string) in CHAR_ESC)
    return CHAR_ESC[body[1] as string] as number;
  throw new Error(`unknown char literal ${t}`);
}

function translateLexer(
  name: string,
  body: string,
  id: (s: string) => number,
): string {
  let out = body
    .replace(/'(\\.|[^'\\])'/g, (lit) => String(charValue(lit)))
    .replace(/START_LEXER\(\);/, "")
    .replace(/eof = lexer->eof\(lexer\);/, "")
    .replace(/ADVANCE_MAP\(([^)]*)\);/g, (_, args: string) => {
      const xs = args
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      let s = "switch (lookahead) {";
      for (let i = 0; i < xs.length; i += 2)
        s += ` case ${xs[i]}: state = ${xs[i + 1]}; continue;`;
      return `${s} }`;
    })
    .replace(/ADVANCE\((\d+)\);/g, "{ state = $1; continue; }")
    .replace(/SKIP\((\d+)\);/g, "{ skip = true; state = $1; continue; }")
    .replace(
      /ACCEPT_TOKEN\((\w+)\);/g,
      (_, s: string) =>
        `result = true; lexer.resultSymbol = ${id(s)}; lexer.markEnd();`,
    )
    .replace(/END_STATE\(\);/g, "return result;")
    .replace(
      /set_contains\((\w+), \d+, lookahead\)/g,
      "setContains($1, lookahead)",
    )
    // C octal literals (tree-sitter-python writes NUL as `00`), which TS rejects.
    .replace(/(?<![\w.])0([0-7]+)\b/g, (_, o: string) =>
      String(Number.parseInt(o, 8)),
    );
  const bad = out.match(
    /.*(lexer->|[A-Z_]{4,}\(|\bgoto\b|\?|'|\(int32_t\)|\(uint).*/,
  );
  if (bad) throw new Error(`${name}: untranslated lexer construct: ${bad[0]}`);
  out = out.trim();
  return `  let result = false;
  let skip = false;
  let first = true;
  for (;;) {
    if (first) first = false;
    else lexer.advance(skip);
    skip = false;
    const lookahead = lexer.lookahead;
    const eof = lexer.eof();
    ${out}
  }`;
}

const only = process.argv.slice(2);
mkdirSync(join(pkg, "src", "generated"), { recursive: true });
for (const [name, g] of Object.entries(GRAMMARS)) {
  if (only.length > 0 && !only.includes(name)) continue;
  const out = join(pkg, "src", "generated", `${name}.ts`);
  const text = compile(name, g.src, g.scanner);
  writeFileSync(out, text);
  console.log(`wrote ${out} (${(text.length / 1024).toFixed(0)} KiB)`);
}
