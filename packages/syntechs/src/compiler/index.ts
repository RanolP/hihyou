// Language-bundle compiler: turns a tree-sitter grammar's generated parser.c, grammar.json and node-types.json
// into the source text of one self-contained ES module (no imports, so any host loads it as is) exporting
//   tables      the numeric parse tables, varint+base64 encoded, for core's `loadLanguage`
//   lex, keywordLex  the two lexer functions, translated from their C control flow
//   grammar     the grammar's structure (kinds, tokens, fields, lists, extras, ...), literal-typed
// Pure and browser-safe; compile.node.ts is the CLI that reads the grammar packages and writes the bundles.
// It fails loudly on any parser.c construct it does not translate, rather than emitting a wrong table.
import {
  ACTION_ACCEPT,
  ACTION_HEADER,
  ACTION_RECOVER,
  ACTION_REDUCE,
  ACTION_SHIFT,
  FLAG_NAMED,
  FLAG_SUPERTYPE,
  FLAG_VISIBLE,
} from "../core/language.js";

export interface GrammarSource {
  /** parser.c as `tree-sitter generate` wrote it. */
  parserC: string;
  /** grammar.json, the normalized grammar next to parser.c. */
  grammarJson: string;
  /** node-types.json, the source of the kind, token and field vocabulary. */
  nodeTypesJson: string;
  /**
   * The extras that are comments. Named rather than derived: extras also hold kinds that are not comments
   * (Python's `line_continuation`, JavaScript's `html_comment`), and a comment printed as code loses its text.
   */
  comments: readonly string[];
  /** Where the tables came from, for the bundle's header line. */
  origin: string;
}

/** The bundle module's source text. */
export function compile(source: GrammarSource): string {
  const grammar = structure(source);
  const { name } = grammar;
  const c = source.parserC.replace(/\r\n/g, "\n");

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

  const symbolNames: string[] = Array.from({ length: total }, () => "");
  for (const m of need(block(/ts_symbol_names\[\] = \{/)).matchAll(
    /\[(\w+)\] = ("(?:[^"\\]|\\.)*")/g,
  ))
    symbolNames[id(m[1] as string)] = cString(m[2] as string);

  const publicMap: number[] = Array.from({ length: total }, () => 0);
  for (const m of need(block(/ts_symbol_map\[\] = \{/)).matchAll(
    /\[(\w+)\] = (\w+)/g,
  ))
    publicMap[id(m[1] as string)] = id(m[2] as string);

  const flags: number[] = Array.from({ length: total }, () => 0);
  for (const m of need(block(/ts_symbol_metadata\[\] = \{/)).matchAll(
    /\[(\w+)\] = \{([^}]*)\}/g,
  )) {
    const body = m[2] as string;
    flags[id(m[1] as string)] =
      (/\.visible = true/.test(body) ? FLAG_VISIBLE : 0) |
      (/\.named = true/.test(body) ? FLAG_NAMED : 0) |
      (/\.supertype = true/.test(body) ? FLAG_SUPERTYPE : 0);
  }

  const fieldNames: string[] = Array.from(
    { length: fieldCount + 1 },
    () => "",
  );
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
  const smallMap: number[] = Array.from(
    { length: stateCount - largeStateCount },
    () => 0,
  );
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
  const sliceIndex: number[] = Array.from(
    { length: productionIdCount },
    () => 0,
  );
  const sliceLength: number[] = Array.from(
    { length: productionIdCount },
    () => 0,
  );
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
  const aliases: number[] = Array.from(
    { length: productionIdCount * maxAliasSequenceLength },
    () => 0,
  );
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
  const lexState: number[] = Array.from({ length: stateCount }, () => 0);
  const externalLexState: number[] = Array.from(
    { length: stateCount },
    () => 0,
  );
  const reservedSet: number[] = Array.from({ length: stateCount }, () => 0);
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
    reservedWords.push(
      ...Array.from({ length: sets * maxReservedWordSetSize }, () => 0),
    );
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
  const externalSymbolMap: number[] = Array.from(
    { length: externalTokenCount },
    () => 0,
  );
  const externalStates: number[] = [];
  if (externalTokenCount > 0) {
    for (const m of need(
      block(/ts_external_scanner_symbol_map\[EXTERNAL_TOKEN_COUNT\] = \{/),
    ).matchAll(/\[(\w+)\] = (\w+)/g))
      externalSymbolMap[id(m[1] as string)] = id(m[2] as string);
    const states = Number(c.match(/ts_external_scanner_states\[(\d+)\]/)?.[1]);
    externalStates.push(
      ...Array.from({ length: states * externalTokenCount }, () => 0),
    );
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
  const data = base64(bytes);

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
  const lexDoc = `/**
 * @param {import("../../core/lexer.js").Lexer} lexer
 * @param {number} state
 * @returns {boolean}
 */`;
  return `// GENERATED by syntechs/compiler from ${source.origin}. Do not edit.

/** @type {import("../../core/language.js").GrammarMeta} */
export const tables = ${metaJson},"data":"${data}"};

/** @type {import("../../core/language.js").LexFn | undefined} */
export const keywordLex = ${kwFn ? "lexKeyword" : "undefined"};

export const grammar = /** @type {const} */ (${JSON.stringify(grammar, null, 2)});

/**
 * \`set_contains\` from parser.h, as core's setContains: binary search over \`[start, end]\` pairs laid out flat.
 * @param {Int32Array} ranges
 * @param {number} lookahead
 */
function setContains(ranges, lookahead) {
  let index = 0;
  let size = ranges.length >> 1;
  while (size > 1) {
    const half = size >> 1;
    const mid = index + half;
    const start = ranges[mid * 2];
    const end = ranges[mid * 2 + 1];
    if (lookahead >= start && lookahead <= end) return true;
    if (lookahead > end) index = mid;
    size -= half;
  }
  return lookahead >= ranges[index * 2] && lookahead <= ranges[index * 2 + 1];
}

${sets.join("\n")}

${lexDoc}
export function lex(lexer, state) {
${lexFn}
}
${kwFn ? `\n${lexDoc}\nfunction lexKeyword(lexer, state) {\n${kwFn}\n}\n` : ""}`;
}

interface Rule {
  type: string;
  name?: string;
  value?: string | number;
  named?: boolean;
  content?: Rule;
  members?: Rule[];
}

interface NodeType {
  type: string;
  named: boolean;
  subtypes?: unknown;
  fields?: Record<string, unknown>;
}

/**
 * One repetition in a rule: `element` lists the kinds and tokens that repeat, `separator` the token between
 * two of them (`commaSep`), `trailing` whether one more separator may close the list, and `open`/`close` the
 * tokens right around it (`[` and `]` around an array's values).
 */
export interface ListShape {
  element: string[];
  separator?: string;
  trailing?: true;
  open?: string;
  close?: string;
}

/** What grammar.json and node-types.json say about the tree's shape, as the bundle's `grammar` export. */
function structure(source: GrammarSource) {
  const g = JSON.parse(source.grammarJson) as {
    name: string;
    word?: string;
    rules: Record<string, Rule>;
    extras: Rule[];
    supertypes?: string[];
    precedences?: Rule[][];
  };
  const nodeTypes = JSON.parse(source.nodeTypesJson) as NodeType[];
  const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

  const extras = g.extras.flatMap((e) =>
    e.type === "SYMBOL" && e.name ? [e.name] : [],
  );
  const comments = sorted(source.comments);
  for (const c of comments)
    if (!extras.includes(c))
      throw new Error(
        `${g.name}: ${c} is not an extra, so the parser cannot place it anywhere; its extras are ${extras.join(", ")}`,
      );

  const fields = Object.fromEntries(
    nodeTypes
      .filter((t) => t.named && !t.subtypes && t.fields)
      .map((t): [string, string[]] => [
        t.type,
        sorted(Object.keys(t.fields ?? {})),
      ])
      .filter(([, fs]) => fs.length > 0)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  const lists: Record<string, ListShape[]> = {};
  for (const [rule, body] of Object.entries(g.rules)) {
    const found: ListShape[] = [];
    walkLists(body, { following: [] }, found);
    const unique = [...new Map(found.map((l) => [JSON.stringify(l), l]))];
    if (unique.length > 0) lists[rule] = unique.map(([, l]) => l);
  }

  return {
    name: g.name,
    kinds: sorted(
      nodeTypes.filter((t) => t.named && !t.subtypes).map((t) => t.type),
    ),
    tokens: sorted(nodeTypes.filter((t) => !t.named).map((t) => t.type)),
    fields,
    comments,
    extras,
    word: g.word ?? null,
    supertypes: g.supertypes ?? [],
    precedences: (g.precedences ?? []).map((level) =>
      level.map((r) => String(r.type === "STRING" ? r.value : r.name)),
    ),
    lists,
  };
}

const stringOf = (r: Rule | undefined): string | undefined =>
  r?.type === "STRING" ? String(r.value) : undefined;

const repeated = (r: Rule | undefined): Rule | undefined =>
  r?.type === "REPEAT" || r?.type === "REPEAT1" ? r.content : undefined;

/** The separator when `r` is `repeat(seq(sep, element))`, the tail of `commaSep`. */
function separatorBefore(
  r: Rule | undefined,
  element: Rule,
): string | undefined {
  const body = repeated(r);
  const members = body?.type === "SEQ" ? (body.members ?? []) : [];
  const separator = stringOf(members[0]);
  if (separator === undefined || members.length < 2) return undefined;
  const rest: Rule =
    members.length === 2
      ? (members[1] as Rule)
      : { type: "SEQ", members: members.slice(1) };
  return JSON.stringify(rest) === JSON.stringify(element)
    ? separator
    : undefined;
}

/** The kinds and tokens a rule can put in the tree, in first-seen order. */
function elements(r: Rule): string[] {
  const out = new Set<string>();
  const visit = (x: Rule) => {
    if (x.type === "SYMBOL" && x.name) out.add(x.name);
    else if (x.type === "STRING" || x.type === "ALIAS")
      out.add(String(x.value));
    else if (x.type === "TOKEN" || x.type === "IMMEDIATE_TOKEN") return;
    if (x.content && x.type !== "ALIAS") visit(x.content);
    for (const m of x.members ?? []) visit(m);
  };
  visit(r);
  return [...out];
}

function shape(
  element: Rule,
  separator: string | undefined,
  trailing: boolean,
  open: string | undefined,
  close: string | undefined,
): ListShape {
  return {
    element: elements(element),
    ...(separator !== undefined ? { separator } : {}),
    ...(trailing ? { trailing: true as const } : {}),
    ...(open !== undefined ? { open } : {}),
    ...(close !== undefined ? { close } : {}),
  };
}

/** `optional(token)`. */
const optionalToken = (r: Rule | undefined, token: string): boolean =>
  r?.type === "CHOICE" &&
  (r.members ?? []).some((o) => stringOf(o) === token) &&
  (r.members ?? []).some((o) => o.type === "BLANK");

/**
 * `before` is the token right before `r` in its enclosing sequences, and `following` what comes after it there,
 * innermost first; optionals are seen through, so `seq("(", optional(commaSep1(x)), ")")` still finds its parens.
 */
function walkLists(
  r: Rule,
  around: { before?: string | undefined; following: Rule[] },
  found: ListShape[],
): void {
  switch (r.type) {
    case "SEQ": {
      const m = r.members ?? [];
      for (let i = 0; i < m.length; i++) {
        const x = m[i] as Rule;
        const before = i > 0 ? stringOf(m[i - 1]) : around.before;
        const separator = separatorBefore(m[i + 1], x);
        if (separator !== undefined) {
          let following = [...m.slice(i + 2), ...around.following];
          const trailing = optionalToken(following[0], separator);
          if (trailing) following = following.slice(1);
          found.push(
            shape(x, separator, trailing, before, stringOf(following[0])),
          );
          walkLists(x, { following: [] }, found);
          i++;
          continue;
        }
        walkLists(
          x,
          { before, following: [...m.slice(i + 1), ...around.following] },
          found,
        );
      }
      return;
    }
    case "REPEAT":
    case "REPEAT1": {
      const body = r.content as Rule;
      found.push(
        shape(
          body,
          undefined,
          false,
          around.before,
          stringOf(around.following[0]),
        ),
      );
      walkLists(body, { following: [] }, found);
      return;
    }
    case "CHOICE":
      for (const m of r.members ?? []) walkLists(m, around, found);
      return;
    // A token's repetitions are lexical: they never show up as children.
    case "TOKEN":
    case "IMMEDIATE_TOKEN":
      return;
    default:
      if (r.content) walkLists(r.content, around, found);
  }
}

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64[n >> 18];
    out += BASE64[(n >> 12) & 63];
    out += b === undefined ? "=" : BASE64[(n >> 6) & 63];
    out += c === undefined ? "=" : BASE64[n & 63];
  }
  return out;
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

/**
 * A C string literal (quotes included) as the UTF-8 text it spells. Escapes name bytes, which may be parts of
 * one multi-byte character, so everything goes through percent-encoded bytes and decodes once as UTF-8.
 */
function cString(lit: string): string {
  let encoded = "";
  const byte = (b: number) => {
    encoded += `%${b.toString(16).padStart(2, "0")}`;
  };
  const body = lit.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = String.fromCodePoint(body.codePointAt(i) as number);
    if (ch !== "\\") {
      encoded += encodeURIComponent(ch);
      i += ch.length - 1;
      continue;
    }
    const e = body[++i] as string;
    if (e === "x") {
      const hex = (
        body.slice(i + 1).match(/^[0-9a-fA-F]+/) as RegExpMatchArray
      )[0];
      byte(Number.parseInt(hex, 16));
      i += hex.length;
    } else if (e in CHAR_ESC) byte(CHAR_ESC[e] as number);
    else throw new Error(`unknown string escape \\${e} in ${lit}`);
  }
  return decodeURIComponent(encoded);
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
