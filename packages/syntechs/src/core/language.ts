// Port of tree-sitter v0.27.0 lib/src/language.{h,c}: parse-table lookups over the tables a generated grammar
// module (src/grammars/*/, written by compiler/compile.node.ts) decodes at load time.
import type { ExternalScanner, Lexer } from "./lexer.js";

export const SYM_END = 0;
export const SYM_ERROR = 65535;
export const SYM_ERROR_REPEAT = 65534;
export const STATE_NONE = 65535;

export const ACTION_SHIFT = 0;
export const ACTION_REDUCE = 1;
export const ACTION_ACCEPT = 2;
export const ACTION_RECOVER = 3;
/** Marks a `ts_parse_actions` slot that is an entry header rather than an action. */
export const ACTION_HEADER = 4;

export const FLAG_VISIBLE = 1;
export const FLAG_NAMED = 2;
export const FLAG_SUPERTYPE = 4;

export type LexFn = (lexer: Lexer, state: number) => boolean;

export interface GrammarMeta {
  name: string;
  abi: number;
  symbolCount: number;
  aliasCount: number;
  tokenCount: number;
  externalTokenCount: number;
  stateCount: number;
  largeStateCount: number;
  productionIdCount: number;
  fieldCount: number;
  maxAliasSequenceLength: number;
  maxReservedWordSetSize: number;
  keywordCaptureToken: number;
  /** Indexed by symbol, aliases included (`symbolCount + aliasCount` entries). */
  symbolNames: string[];
  /** Indexed by field id; index 0 is unused. */
  fieldNames: string[];
  /** The numeric tables, varint-encoded then base64'd, in the order `decodeTables` reads them. */
  data: string;
}

export interface Language {
  name: string;
  symbolCount: number;
  tokenCount: number;
  externalTokenCount: number;
  stateCount: number;
  largeStateCount: number;
  fieldCount: number;
  maxAliasSequenceLength: number;
  maxReservedWordSetSize: number;
  keywordCaptureToken: number;
  symbolNames: string[];
  fieldNames: string[];
  symbolFlags: Uint8Array;
  publicSymbolMap: Uint16Array;
  parseTable: Uint16Array;
  smallTable: Uint16Array;
  smallMap: Uint32Array;
  /** Per `ts_parse_actions` slot. Header: a = count, b = reusable. Shift: a = state, b = 1 extra | 2 repetition. Reduce: a = symbol, b = child count, c = dynamic precedence, d = production id. */
  actType: Uint8Array;
  actA: Uint16Array;
  actB: Uint16Array;
  actC: Int16Array;
  actD: Uint16Array;
  fieldSliceIndex: Uint16Array;
  fieldSliceLength: Uint16Array;
  fieldEntryField: Uint16Array;
  fieldEntryChild: Uint8Array;
  fieldEntryInherited: Uint8Array;
  aliasSequences: Uint16Array;
  lexState: Uint16Array;
  externalLexState: Uint16Array;
  reservedWordSetId: Uint16Array;
  reservedWords: Uint16Array;
  externalSymbolMap: Uint16Array;
  /** `[externalLexState * externalTokenCount + token]` is 1 when that external token is valid. */
  externalStates: Uint8Array;
  lex: LexFn;
  keywordLex: LexFn | undefined;
  createScanner: (() => ExternalScanner) | undefined;
}

// ---- table decoding ----------------------------------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(s: string): Uint8Array {
  const rev = new Uint8Array(128);
  for (let i = 0; i < 64; i++) rev[B64.charCodeAt(i)] = i;
  let len = s.length;
  while (len > 0 && s.charCodeAt(len - 1) === 61) len--;
  const out = new Uint8Array((len * 3) >> 2);
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    buf = (buf << 6) | (rev[s.charCodeAt(i)] as number);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 255;
    }
  }
  return out;
}

class Reader {
  private at = 0;
  constructor(private readonly bytes: Uint8Array) {}
  uint(): number {
    let result = 0;
    let shift = 1;
    for (;;) {
      const b = this.bytes[this.at++];
      if (b === undefined) throw new Error("grammar tables are truncated");
      result += (b & 127) * shift;
      if (b < 128) return result;
      shift *= 128;
    }
  }
  int(): number {
    const z = this.uint();
    return z % 2 === 1 ? -(z + 1) / 2 : z / 2;
  }
  fill<T extends { length: number; [i: number]: number }>(array: T): T {
    for (let i = 0; i < array.length; i++) array[i] = this.uint();
    return array;
  }
  done(): void {
    if (this.at !== this.bytes.length)
      throw new Error(
        `grammar tables have ${this.bytes.length - this.at} trailing bytes`,
      );
  }
}

export function loadLanguage(
  meta: GrammarMeta,
  lex: LexFn,
  keywordLex: LexFn | undefined,
  createScanner: (() => ExternalScanner) | undefined,
): Language {
  const r = new Reader(base64(meta.data));
  const total = meta.symbolCount + meta.aliasCount;
  const symbolFlags = r.fill(new Uint8Array(total));
  const publicSymbolMap = r.fill(new Uint16Array(total));

  const parseTable = new Uint16Array(meta.largeStateCount * meta.symbolCount);
  for (let s = 0; s < meta.largeStateCount; s++) {
    const pairs = r.uint();
    let sym = 0;
    for (let i = 0; i < pairs; i++) {
      sym += r.uint();
      parseTable[s * meta.symbolCount + sym] = r.uint();
    }
  }
  const smallTable = r.fill(new Uint16Array(r.uint()));
  const smallMap = r.fill(
    new Uint32Array(meta.stateCount - meta.largeStateCount),
  );

  const slots = r.uint();
  const actType = new Uint8Array(slots);
  const actA = new Uint16Array(slots);
  const actB = new Uint16Array(slots);
  const actC = new Int16Array(slots);
  const actD = new Uint16Array(slots);
  for (let i = 0; i < slots; i++) {
    const t = r.uint();
    actType[i] = t;
    if (t === ACTION_HEADER || t === ACTION_SHIFT) {
      actA[i] = r.uint();
      actB[i] = r.uint();
    } else if (t === ACTION_REDUCE) {
      actA[i] = r.uint();
      actB[i] = r.uint();
      actC[i] = r.int();
      actD[i] = r.uint();
    }
  }

  const fieldSliceIndex = new Uint16Array(meta.productionIdCount);
  const fieldSliceLength = new Uint16Array(meta.productionIdCount);
  for (let p = 0; p < meta.productionIdCount; p++) {
    fieldSliceIndex[p] = r.uint();
    fieldSliceLength[p] = r.uint();
  }
  const entries = r.uint();
  const fieldEntryField = new Uint16Array(entries);
  const fieldEntryChild = new Uint8Array(entries);
  const fieldEntryInherited = new Uint8Array(entries);
  for (let i = 0; i < entries; i++) {
    fieldEntryField[i] = r.uint();
    fieldEntryChild[i] = r.uint();
    fieldEntryInherited[i] = r.uint();
  }
  const aliasSequences = r.fill(
    new Uint16Array(meta.productionIdCount * meta.maxAliasSequenceLength),
  );
  const lexState = r.fill(new Uint16Array(meta.stateCount));
  const externalLexState = r.fill(new Uint16Array(meta.stateCount));
  const reservedWordSetId = r.fill(new Uint16Array(meta.stateCount));
  const reservedWords = r.fill(new Uint16Array(r.uint()));
  const externalSymbolMap = r.fill(new Uint16Array(meta.externalTokenCount));
  const externalStates = r.fill(new Uint8Array(r.uint()));
  r.done();

  return {
    name: meta.name,
    symbolCount: meta.symbolCount,
    tokenCount: meta.tokenCount,
    externalTokenCount: meta.externalTokenCount,
    stateCount: meta.stateCount,
    largeStateCount: meta.largeStateCount,
    fieldCount: meta.fieldCount,
    maxAliasSequenceLength: meta.maxAliasSequenceLength,
    maxReservedWordSetSize: meta.maxReservedWordSetSize,
    keywordCaptureToken: meta.keywordCaptureToken,
    symbolNames: meta.symbolNames,
    fieldNames: meta.fieldNames,
    symbolFlags,
    publicSymbolMap,
    parseTable,
    smallTable,
    smallMap,
    actType,
    actA,
    actB,
    actC,
    actD,
    fieldSliceIndex,
    fieldSliceLength,
    fieldEntryField,
    fieldEntryChild,
    fieldEntryInherited,
    aliasSequences,
    lexState,
    externalLexState,
    reservedWordSetId,
    reservedWords,
    externalSymbolMap,
    externalStates,
    lex,
    keywordLex,
    createScanner,
  };
}

/** `set_contains` from parser.h: binary search over `[start, end]` pairs laid out flat. */
export function setContains(ranges: Int32Array, lookahead: number): boolean {
  let index = 0;
  let size = ranges.length >> 1;
  while (size > 1) {
    const half = size >> 1;
    const mid = index + half;
    const start = ranges[mid * 2] as number;
    const end = ranges[mid * 2 + 1] as number;
    if (lookahead >= start && lookahead <= end) return true;
    if (lookahead > end) index = mid;
    size -= half;
  }
  return (
    lookahead >= (ranges[index * 2] as number) &&
    lookahead <= (ranges[index * 2 + 1] as number)
  );
}

// ---- lookups -------------------------------------------------------------------------------------------------

export function lookup(lang: Language, state: number, symbol: number): number {
  if (state >= lang.largeStateCount) {
    const table = lang.smallTable;
    let i = lang.smallMap[state - lang.largeStateCount] as number;
    const groups = table[i++] as number;
    for (let g = 0; g < groups; g++) {
      const value = table[i++] as number;
      const count = table[i++] as number;
      for (let j = 0; j < count; j++) if (table[i++] === symbol) return value;
    }
    return 0;
  }
  return lang.parseTable[state * lang.symbolCount + symbol] as number;
}

/** The index of the entry header in the actions table; its actions follow at `+1 .. +count`. 0 for no actions. */
export function tableEntry(
  lang: Language,
  state: number,
  symbol: number,
): number {
  if (symbol === SYM_ERROR || symbol === SYM_ERROR_REPEAT) return 0;
  return lookup(lang, state, symbol);
}

export function actionCount(lang: Language, entry: number): number {
  return lang.actA[entry] as number;
}

export function isReusable(lang: Language, entry: number): boolean {
  return lang.actB[entry] !== 0;
}

export function hasReduceAction(
  lang: Language,
  state: number,
  symbol: number,
): boolean {
  const e = tableEntry(lang, state, symbol);
  return (lang.actA[e] as number) > 0 && lang.actType[e + 1] === ACTION_REDUCE;
}

export function hasActions(
  lang: Language,
  state: number,
  symbol: number,
): boolean {
  return lookup(lang, state, symbol) !== 0;
}

export function nextState(
  lang: Language,
  state: number,
  symbol: number,
): number {
  if (
    symbol === SYM_ERROR ||
    symbol === SYM_ERROR_REPEAT ||
    symbol >= lang.symbolCount ||
    state >= lang.stateCount
  )
    return 0;
  if (symbol < lang.tokenCount) {
    const e = tableEntry(lang, state, symbol);
    const count = lang.actA[e] as number;
    if (count > 0) {
      const last = e + count;
      if (lang.actType[last] === ACTION_SHIFT)
        return (lang.actB[last] as number) & 1
          ? state
          : (lang.actA[last] as number);
    }
    return 0;
  }
  return lookup(lang, state, symbol);
}

export function isReservedWord(
  lang: Language,
  state: number,
  symbol: number,
): boolean {
  const set = lang.reservedWordSetId[state] as number;
  if (set > 0) {
    const start = set * lang.maxReservedWordSetSize;
    const end = start + lang.maxReservedWordSetSize;
    for (let i = start; i < end; i++) {
      const w = lang.reservedWords[i];
      if (w === symbol) return true;
      if (w === 0) break;
    }
  }
  return false;
}

export function symbolFlags(lang: Language, symbol: number): number {
  if (symbol === SYM_ERROR) return FLAG_VISIBLE | FLAG_NAMED;
  if (symbol === SYM_ERROR_REPEAT) return 0;
  return lang.symbolFlags[symbol] as number;
}

export function publicSymbol(lang: Language, symbol: number): number {
  if (symbol === SYM_ERROR) return symbol;
  return lang.publicSymbolMap[symbol] as number;
}

export function symbolName(lang: Language, symbol: number): string {
  if (symbol === SYM_ERROR) return "ERROR";
  if (symbol === SYM_ERROR_REPEAT) return "_ERROR";
  return lang.symbolNames[symbol] ?? "";
}

export function aliasAt(
  lang: Language,
  productionId: number,
  childIndex: number,
): number {
  if (productionId === 0 || childIndex >= lang.maxAliasSequenceLength) return 0;
  return lang.aliasSequences[
    productionId * lang.maxAliasSequenceLength + childIndex
  ] as number;
}
