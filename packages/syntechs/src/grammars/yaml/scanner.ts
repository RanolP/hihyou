// Port of tree-sitter-yaml 0.7.2 src/scanner.c (core schema): YAML's indentation-sensitive tokens. The scanner
// keeps a stack of open indentations (root, mapping, sequence, block string) and classifies every token by where
// it starts relative to the current one: `r` on the same row, `br` on a later row past the indentation, `b` on a
// later row at it, `bl` (a block end) at or before the parent's. Plain scalars are resolved against the core
// schema by schema.ts as they are read. The state serializes as scanner.c's does, int16 by int16.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { advSchStt, RS_BOOL, RS_FLOAT, RS_INT, RS_NULL, RS_STR, SCH_STT_FRZ } from "./schema.js";

// The grammar's externals, in their order.
const TOKENS = [
  "END_OF_FILE",
  "S_DIR_YML_BGN", "R_DIR_YML_VER",
  "S_DIR_TAG_BGN", "R_DIR_TAG_HDL", "R_DIR_TAG_PFX",
  "S_DIR_RSV_BGN", "R_DIR_RSV_PRM",
  "S_DRS_END",
  "S_DOC_END",
  "R_BLK_SEQ_BGN", "BR_BLK_SEQ_BGN", "B_BLK_SEQ_BGN",
  "R_BLK_KEY_BGN", "BR_BLK_KEY_BGN", "B_BLK_KEY_BGN",
  "R_BLK_VAL_BGN", "BR_BLK_VAL_BGN", "B_BLK_VAL_BGN",
  "R_BLK_IMP_BGN",
  "R_BLK_LIT_BGN", "BR_BLK_LIT_BGN",
  "R_BLK_FLD_BGN", "BR_BLK_FLD_BGN",
  "BR_BLK_STR_CTN",
  "R_FLW_SEQ_BGN", "BR_FLW_SEQ_BGN", "B_FLW_SEQ_BGN",
  "R_FLW_SEQ_END", "BR_FLW_SEQ_END", "B_FLW_SEQ_END",
  "R_FLW_MAP_BGN", "BR_FLW_MAP_BGN", "B_FLW_MAP_BGN",
  "R_FLW_MAP_END", "BR_FLW_MAP_END", "B_FLW_MAP_END",
  "R_FLW_SEP_BGN", "BR_FLW_SEP_BGN",
  "R_FLW_KEY_BGN", "BR_FLW_KEY_BGN",
  "R_FLW_JSV_BGN", "BR_FLW_JSV_BGN",
  "R_FLW_NJV_BGN", "BR_FLW_NJV_BGN",
  "R_DQT_STR_BGN", "BR_DQT_STR_BGN", "B_DQT_STR_BGN",
  "R_DQT_STR_CTN", "BR_DQT_STR_CTN",
  "R_DQT_ESC_NWL", "BR_DQT_ESC_NWL",
  "R_DQT_ESC_SEQ", "BR_DQT_ESC_SEQ",
  "R_DQT_STR_END", "BR_DQT_STR_END",
  "R_SQT_STR_BGN", "BR_SQT_STR_BGN", "B_SQT_STR_BGN",
  "R_SQT_STR_CTN", "BR_SQT_STR_CTN",
  "R_SQT_ESC_SQT", "BR_SQT_ESC_SQT",
  "R_SQT_STR_END", "BR_SQT_STR_END",
  "R_SGL_PLN_NUL_BLK", "BR_SGL_PLN_NUL_BLK", "B_SGL_PLN_NUL_BLK", "R_SGL_PLN_NUL_FLW", "BR_SGL_PLN_NUL_FLW",
  "R_SGL_PLN_BOL_BLK", "BR_SGL_PLN_BOL_BLK", "B_SGL_PLN_BOL_BLK", "R_SGL_PLN_BOL_FLW", "BR_SGL_PLN_BOL_FLW",
  "R_SGL_PLN_INT_BLK", "BR_SGL_PLN_INT_BLK", "B_SGL_PLN_INT_BLK", "R_SGL_PLN_INT_FLW", "BR_SGL_PLN_INT_FLW",
  "R_SGL_PLN_FLT_BLK", "BR_SGL_PLN_FLT_BLK", "B_SGL_PLN_FLT_BLK", "R_SGL_PLN_FLT_FLW", "BR_SGL_PLN_FLT_FLW",
  "R_SGL_PLN_TMS_BLK", "BR_SGL_PLN_TMS_BLK", "B_SGL_PLN_TMS_BLK", "R_SGL_PLN_TMS_FLW", "BR_SGL_PLN_TMS_FLW",
  "R_SGL_PLN_STR_BLK", "BR_SGL_PLN_STR_BLK", "B_SGL_PLN_STR_BLK", "R_SGL_PLN_STR_FLW", "BR_SGL_PLN_STR_FLW",
  "R_MTL_PLN_STR_BLK", "BR_MTL_PLN_STR_BLK",
  "R_MTL_PLN_STR_FLW", "BR_MTL_PLN_STR_FLW",
  "R_TAG", "BR_TAG", "B_TAG",
  "R_ACR_BGN", "BR_ACR_BGN", "B_ACR_BGN", "R_ACR_CTN",
  "R_ALS_BGN", "BR_ALS_BGN", "B_ALS_BGN", "R_ALS_CTN",
  "BL",
  "COMMENT",
  "ERR_REC",
] as const;
const T = Object.fromEntries(TOKENS.map((name, i) => [name, i])) as Record<(typeof TOKENS)[number], number>;

const SCN_SUCC = 1;
const SCN_STOP = 0;
const SCN_FAIL = -1;

const IND_ROT = 114; // 'r'
const IND_MAP = 109; // 'm'
const IND_SEQ = 113; // 'q'
const IND_STR = 115; // 's'

const SERIALIZATION_BUFFER_SIZE = 1024;

const ch = (s: string) => s.charCodeAt(0);
const isWsp = (c: number) => c === 32 || c === 9;
const isNwl = (c: number) => c === 13 || c === 10;
const isWht = (c: number) => isWsp(c) || isNwl(c) || c === 0;
const isNsDecDigit = (c: number) => c >= 48 && c <= 57;
const isNsHexDigit = (c: number) => isNsDecDigit(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
const isNsWordChar = (c: number) =>
  c === 45 || (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
const isNbJson = (c: number) => c === 0x09 || (c >= 0x20 && c <= 0x10ffff);
const isNbDoubleChar = (c: number) => isNbJson(c) && c !== 92 && c !== 34;
const isNbSingleChar = (c: number) => isNbJson(c) && c !== 39;
const isNsChar = (c: number) =>
  (c >= 0x21 && c <= 0x7e) ||
  c === 0x85 ||
  (c >= 0xa0 && c <= 0xd7ff) ||
  (c >= 0xe000 && c <= 0xfefe) ||
  (c >= 0xff00 && c <= 0xfffd) ||
  (c >= 0x10000 && c <= 0x10ffff);
const C_INDICATORS = new Set([..."-?:,[]{}#&*!|>'\"%@`"].map(ch));
const isCIndicator = (c: number) => C_INDICATORS.has(c);
const C_FLOW_INDICATORS = new Set([...",[]{}"].map(ch));
const isCFlowIndicator = (c: number) => C_FLOW_INDICATORS.has(c);
const isPlainSafeInBlock = (c: number) => isNsChar(c);
const isPlainSafeInFlow = (c: number) => isNsChar(c) && !isCFlowIndicator(c);
const URI_PUNCT = new Set([..."#;/?:@&=+$,_.!~*'()[]"].map(ch));
const isNsUriChar = (c: number) => isNsWordChar(c) || URI_PUNCT.has(c);
const TAG_PUNCT = new Set([..."#;/?:@&=+$_.~*'()"].map(ch));
const isNsTagChar = (c: number) => isNsWordChar(c) || TAG_PUNCT.has(c);
const isNsAnchorChar = (c: number) => isNsChar(c) && !isCFlowIndicator(c);

/** Thrown where scanner.c returns false from inside a macro (POP_IND, PUSH_BGN_IND, MAY_PUSH_IMP_IND). */
const REFUSE = Symbol("refuse");

class YamlScanner implements ExternalScanner {
  row = 0;
  col = 0;
  blkImpRow = -1;
  blkImpCol = -1;
  blkImpTab = 0;
  indTypStk: number[] = [IND_ROT];
  indLenStk: number[] = [-1];

  endRow = 0;
  endCol = 0;
  curRow = 0;
  curCol = 0;
  curChr = 0;
  schStt = 0;
  readonly rlt = { rlt: RS_STR };

  adv(lexer: Lexer): void {
    this.curCol++;
    this.curChr = lexer.lookahead;
    lexer.advance(false);
  }

  advNwl(lexer: Lexer): void {
    this.curRow++;
    this.curCol = 0;
    this.curChr = lexer.lookahead;
    lexer.advance(false);
  }

  skp(lexer: Lexer): void {
    this.curCol++;
    this.curChr = lexer.lookahead;
    lexer.advance(true);
  }

  skpNwl(lexer: Lexer): void {
    this.curRow++;
    this.curCol = 0;
    this.curChr = lexer.lookahead;
    lexer.advance(true);
  }

  mrkEnd(lexer: Lexer): void {
    this.endRow = this.curRow;
    this.endCol = this.curCol;
    lexer.markEnd();
  }

  init(): void {
    this.curRow = this.row;
    this.curCol = this.col;
    this.curChr = 0;
    this.schStt = 0;
    this.rlt.rlt = RS_STR;
  }

  /** RET_SYM. */
  ret(lexer: Lexer, symbol: number): true {
    this.row = this.endRow;
    this.col = this.endCol;
    lexer.resultSymbol = symbol;
    return true;
  }

  popInd(): void {
    // POP_IND: an incorrect status caused by error recovery.
    if (this.indTypStk.length === 1) throw REFUSE;
    this.indLenStk.pop();
    this.indTypStk.pop();
  }

  pushInd(typ: number, len: number): void {
    this.indLenStk.push(len);
    this.indTypStk.push(typ);
  }

  advSch(): void {
    this.schStt = advSchStt(this.schStt, this.curChr, this.rlt);
  }

  /** SGL_PLN_SYM, without timestamps (schema.core.c's HAS_TIMESTAMP is 0). */
  sglPlnSym(pos: "R" | "BR" | "B", ctx: "BLK" | "FLW"): number {
    const r = this.rlt.rlt;
    const kind = r === RS_NULL ? "NUL" : r === RS_BOOL ? "BOL" : r === RS_INT ? "INT" : r === RS_FLOAT ? "FLT" : "STR";
    return T[`${pos}_SGL_PLN_${kind}_${ctx}` as (typeof TOKENS)[number]];
  }

  scnUriEsc(lexer: Lexer): number {
    if (lexer.lookahead !== 37) return SCN_STOP;
    this.mrkEnd(lexer);
    this.adv(lexer);
    if (!isNsHexDigit(lexer.lookahead)) return SCN_FAIL;
    this.adv(lexer);
    if (!isNsHexDigit(lexer.lookahead)) return SCN_FAIL;
    this.adv(lexer);
    return SCN_SUCC;
  }

  scnNsUriChar(lexer: Lexer): number {
    if (isNsUriChar(lexer.lookahead)) {
      this.adv(lexer);
      return SCN_SUCC;
    }
    return this.scnUriEsc(lexer);
  }

  scnNsTagChar(lexer: Lexer): number {
    if (isNsTagChar(lexer.lookahead)) {
      this.adv(lexer);
      return SCN_SUCC;
    }
    return this.scnUriEsc(lexer);
  }

  /** Advances over `word`'s characters while they match; whether all did. */
  advWord(lexer: Lexer, word: string): boolean {
    for (const c of word) {
      if (lexer.lookahead !== ch(c)) return false;
      this.adv(lexer);
    }
    return true;
  }

  scnDirBgn(lexer: Lexer): boolean {
    this.adv(lexer);
    if (lexer.lookahead === ch("Y")) {
      if (this.advWord(lexer, "YAML") && isWht(lexer.lookahead)) {
        this.mrkEnd(lexer);
        return this.ret(lexer, T.S_DIR_YML_BGN);
      }
    } else if (lexer.lookahead === ch("T")) {
      if (this.advWord(lexer, "TAG") && isWht(lexer.lookahead)) {
        this.mrkEnd(lexer);
        return this.ret(lexer, T.S_DIR_TAG_BGN);
      }
    }
    while (isNsChar(lexer.lookahead)) this.adv(lexer);
    if (this.curCol > 1 && isWht(lexer.lookahead)) {
      this.mrkEnd(lexer);
      return this.ret(lexer, T.S_DIR_RSV_BGN);
    }
    return false;
  }

  scnDirYmlVer(lexer: Lexer, symbol: number): boolean {
    let n1 = 0;
    let n2 = 0;
    while (isNsDecDigit(lexer.lookahead)) {
      this.adv(lexer);
      n1++;
    }
    if (lexer.lookahead !== 46) return false;
    this.adv(lexer);
    while (isNsDecDigit(lexer.lookahead)) {
      this.adv(lexer);
      n2++;
    }
    if (n1 === 0 || n2 === 0) return false;
    this.mrkEnd(lexer);
    return this.ret(lexer, symbol);
  }

  scnTagHdlTal(lexer: Lexer): boolean {
    if (lexer.lookahead === 33) {
      this.adv(lexer);
      return true;
    }
    let n = 0;
    while (isNsWordChar(lexer.lookahead)) {
      this.adv(lexer);
      n++;
    }
    if (n === 0) return true;
    if (lexer.lookahead === 33) {
      this.adv(lexer);
      return true;
    }
    return false;
  }

  scnDirTagHdl(lexer: Lexer, symbol: number): boolean {
    if (lexer.lookahead === 33) {
      this.adv(lexer);
      if (this.scnTagHdlTal(lexer)) {
        this.mrkEnd(lexer);
        return this.ret(lexer, symbol);
      }
    }
    return false;
  }

  scnDirTagPfx(lexer: Lexer, symbol: number): boolean {
    if (lexer.lookahead === 33) this.adv(lexer);
    else if (this.scnNsTagChar(lexer) !== SCN_SUCC) return false;
    for (;;) {
      const r = this.scnNsUriChar(lexer);
      if (r === SCN_STOP) this.mrkEnd(lexer);
      if (r !== SCN_SUCC) return this.ret(lexer, symbol);
    }
  }

  scnDirRsvPrm(lexer: Lexer, symbol: number): boolean {
    if (!isNsChar(lexer.lookahead)) return false;
    this.adv(lexer);
    while (isNsChar(lexer.lookahead)) this.adv(lexer);
    this.mrkEnd(lexer);
    return this.ret(lexer, symbol);
  }

  scnTag(lexer: Lexer, symbol: number): boolean {
    if (lexer.lookahead !== 33) return false;
    this.adv(lexer);
    if (isWht(lexer.lookahead)) {
      this.mrkEnd(lexer);
      return this.ret(lexer, symbol);
    }
    // `as number`: TypeScript keeps the `!` narrowing across `adv`, which moves the lookahead.
    if ((lexer.lookahead as number) === 60) {
      this.adv(lexer);
      if (this.scnNsUriChar(lexer) !== SCN_SUCC) return false;
      for (;;) {
        const r = this.scnNsUriChar(lexer);
        if (r === SCN_STOP && (lexer.lookahead as number) === 62) {
          this.adv(lexer);
          this.mrkEnd(lexer);
          return this.ret(lexer, symbol);
        }
        if (r !== SCN_SUCC) return false;
      }
    }
    if (this.scnTagHdlTal(lexer) && this.scnNsTagChar(lexer) !== SCN_SUCC) return false;
    for (;;) {
      const r = this.scnNsTagChar(lexer);
      if (r === SCN_STOP) this.mrkEnd(lexer);
      if (r !== SCN_SUCC) return this.ret(lexer, symbol);
    }
  }

  /** scn_acr_bgn and scn_als_bgn: `&` or `*` followed by an anchor character. */
  scnPropBgn(lexer: Lexer, indicator: number, symbol: number): boolean {
    if (lexer.lookahead !== indicator) return false;
    this.adv(lexer);
    if (!isNsAnchorChar(lexer.lookahead)) return false;
    this.mrkEnd(lexer);
    return this.ret(lexer, symbol);
  }

  /** scn_acr_ctn and scn_als_ctn. */
  scnPropCtn(lexer: Lexer, symbol: number): boolean {
    while (isNsAnchorChar(lexer.lookahead)) this.adv(lexer);
    this.mrkEnd(lexer);
    return this.ret(lexer, symbol);
  }

  scnDqtEscSeq(lexer: Lexer, symbol: number): boolean {
    const c = lexer.lookahead;
    const hex = c === ch("U") ? 8 : c === ch("u") ? 4 : c === ch("x") ? 2 : -1;
    if (hex > 0) {
      this.adv(lexer);
      for (let i = 0; i < hex; i++) {
        if (!isNsHexDigit(lexer.lookahead)) return false;
        this.adv(lexer);
      }
    } else if ([..."0abt\tnvref \"/\\N_LP"].map(ch).includes(c)) this.adv(lexer);
    else return false;
    this.mrkEnd(lexer);
    return this.ret(lexer, symbol);
  }

  scnDrsDocEnd(lexer: Lexer): boolean {
    if (lexer.lookahead !== 45 && lexer.lookahead !== 46) return false;
    const delimiter = lexer.lookahead;
    this.adv(lexer);
    if (lexer.lookahead === delimiter) {
      this.adv(lexer);
      if (lexer.lookahead === delimiter) {
        this.adv(lexer);
        if (isWht(lexer.lookahead)) return true;
      }
    }
    this.mrkEnd(lexer);
    return false;
  }

  /** scn_dqt_str_cnt and scn_sqt_str_cnt. */
  scnQtStrCnt(lexer: Lexer, isChar: (c: number) => boolean, symbol: number): boolean {
    if (!isChar(lexer.lookahead)) return false;
    if (this.curCol === 0 && this.scnDrsDocEnd(lexer)) {
      this.mrkEnd(lexer);
      return this.ret(lexer, this.curChr === 45 ? T.S_DRS_END : T.S_DOC_END);
    }
    this.adv(lexer);
    while (isChar(lexer.lookahead)) this.adv(lexer);
    this.mrkEnd(lexer);
    return this.ret(lexer, symbol);
  }

  scnBlkStrBgn(lexer: Lexer, symbol: number): boolean {
    if (lexer.lookahead !== 124 && lexer.lookahead !== 62) return false;
    this.adv(lexer);
    const curInd = this.indLenStk.at(-1) as number;
    let ind = -1;
    const isSign = (c: number) => c === 43 || c === 45;
    const isIndDigit = (c: number) => c >= 49 && c <= 57;
    if (isIndDigit(lexer.lookahead)) {
      ind = lexer.lookahead - 49;
      this.adv(lexer);
      if (isSign(lexer.lookahead)) this.adv(lexer);
    } else if (isSign(lexer.lookahead)) {
      this.adv(lexer);
      if (isIndDigit(lexer.lookahead)) {
        ind = lexer.lookahead - 49;
        this.adv(lexer);
      }
    }
    if (!isWht(lexer.lookahead)) return false;
    this.mrkEnd(lexer);
    if (ind !== -1) ind += curInd;
    else {
      ind = curInd;
      while (isWsp(lexer.lookahead)) this.adv(lexer);
      if (lexer.lookahead === 35) {
        this.adv(lexer);
        while (!isNwl(lexer.lookahead) && lexer.lookahead !== 0) this.adv(lexer);
      }
      if (isNwl(lexer.lookahead)) this.advNwl(lexer);
      while (lexer.lookahead !== 0) {
        if (lexer.lookahead === 32) this.adv(lexer);
        else if (isNwl(lexer.lookahead)) {
          if (this.curCol - 1 < ind) break;
          ind = this.curCol - 1;
          this.advNwl(lexer);
        } else {
          if (this.curCol - 1 > ind) ind = this.curCol - 1;
          break;
        }
      }
    }
    this.pushInd(IND_STR, ind);
    return this.ret(lexer, symbol);
  }

  scnBlkStrCnt(lexer: Lexer, symbol: number): boolean {
    if (!isNsChar(lexer.lookahead)) return false;
    if (this.curCol === 0 && this.scnDrsDocEnd(lexer)) {
      this.popInd();
      return this.ret(lexer, T.BL);
    }
    this.adv(lexer);
    this.mrkEnd(lexer);
    for (;;) {
      if (isNsChar(lexer.lookahead)) {
        this.adv(lexer);
        while (isNsChar(lexer.lookahead)) this.adv(lexer);
        this.mrkEnd(lexer);
      }
      if (!isWsp(lexer.lookahead)) break;
      this.adv(lexer);
      while (isWsp(lexer.lookahead)) this.adv(lexer);
    }
    return this.ret(lexer, symbol);
  }

  scnPlnCnt(lexer: Lexer, isPlainSafe: (c: number) => boolean): number {
    let isCurSaf = isPlainSafe(this.curChr);
    let isLkaWsp = isWsp(lexer.lookahead);
    let isLkaSaf = isPlainSafe(lexer.lookahead);
    if (!isLkaSaf && !isLkaWsp) return SCN_STOP;
    for (;;) {
      if (isLkaSaf && lexer.lookahead !== 35 && lexer.lookahead !== 58) {
        this.adv(lexer);
        this.mrkEnd(lexer);
        this.advSch();
      } else if (isCurSaf && lexer.lookahead === 35) {
        this.adv(lexer);
        this.mrkEnd(lexer);
        this.advSch();
      } else if (isLkaWsp) {
        this.adv(lexer);
        this.advSch();
      } else if (lexer.lookahead === 58) this.adv(lexer); // checked below
      else break;

      isCurSaf = isLkaSaf;
      isLkaWsp = isWsp(lexer.lookahead);
      isLkaSaf = isPlainSafe(lexer.lookahead);

      if (this.curChr === 58) {
        if (!isLkaSaf) return SCN_FAIL;
        this.mrkEnd(lexer);
        this.advSch();
      }
    }
    return SCN_SUCC;
  }

  /** MAY_UPD_IMP_COL. */
  mayUpdImpCol(bgnRow: number, bgnCol: number, hasTabInd: boolean): void {
    if (this.blkImpRow !== bgnRow) {
      this.blkImpRow = bgnRow;
      this.blkImpCol = bgnCol;
      this.blkImpTab = hasTabInd ? 1 : 0;
    }
  }

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    try {
      return this.scanInner(lexer, valid);
    } catch (e) {
      if (e === REFUSE) return false;
      throw e;
    }
  }

  scanInner(lexer: Lexer, valid: Uint8Array): boolean {
    this.init();
    this.mrkEnd(lexer);

    const allowComment = !(
      valid[T.R_DQT_STR_CTN] ||
      valid[T.BR_DQT_STR_CTN] ||
      valid[T.R_SQT_STR_CTN] ||
      valid[T.BR_SQT_STR_CTN]
    );
    const depth = this.indLenStk.length;
    const curInd = this.indLenStk[depth - 1] as number;
    const prtInd = depth >= 2 ? (this.indLenStk[depth - 2] as number) : -1;
    const curIndTyp = this.indTypStk.at(-1) as number;

    let hasTabInd = false;
    let leadingSpaces = 0;

    for (;;) {
      const c = lexer.lookahead;
      if (c === 32) {
        if (!hasTabInd) leadingSpaces++;
        this.skp(lexer);
      } else if (c === 9) {
        hasTabInd = true;
        this.skp(lexer);
      } else if (isNwl(c)) {
        hasTabInd = false;
        leadingSpaces = 0;
        this.skpNwl(lexer);
      } else if (allowComment && c === 35) {
        if (valid[T.BR_BLK_STR_CTN] && valid[T.BL] && this.curCol <= curInd) {
          this.popInd();
          return this.ret(lexer, T.BL);
        }
        const startsComment = valid[T.BR_BLK_STR_CTN]
          ? this.curRow === this.row
          : this.curCol === 0 || this.curRow !== this.row || this.curCol > this.col;
        if (!startsComment) break;
        this.adv(lexer);
        while (!isNwl(lexer.lookahead) && lexer.lookahead !== 0) this.adv(lexer);
        this.mrkEnd(lexer);
        return this.ret(lexer, T.COMMENT);
      } else break;
    }

    if (lexer.lookahead === 0) {
      if (valid[T.BL]) {
        this.mrkEnd(lexer);
        this.popInd();
        return this.ret(lexer, T.BL);
      }
      if (valid[T.END_OF_FILE]) {
        this.mrkEnd(lexer);
        return this.ret(lexer, T.END_OF_FILE);
      }
      return false;
    }

    const bgnRow = this.curRow;
    const bgnCol = this.curCol;
    const bgnChr = lexer.lookahead;

    if (valid[T.BL] && bgnCol <= curInd && !hasTabInd) {
      const ends =
        curInd === prtInd && curIndTyp === IND_SEQ
          ? bgnCol < curInd || lexer.lookahead !== 45
          : bgnCol <= prtInd || curIndTyp === IND_STR;
      if (ends) {
        this.popInd();
        return this.ret(lexer, T.BL);
      }
    }

    const hasNwl = this.curRow > this.row;
    const isR = !hasNwl;
    const isBr = hasNwl && leadingSpaces > curInd;
    const isB = hasNwl && leadingSpaces === curInd && !hasTabInd;
    const isS = bgnCol === 0;
    const updImpCol = () => this.mayUpdImpCol(bgnRow, bgnCol, hasTabInd);
    /** PUSH_BGN_IND. */
    const pushBgnInd = (typ: number) => {
      if (hasTabInd) throw REFUSE;
      this.pushInd(typ, bgnCol);
    };
    /** One character, then the token. */
    const single = (symbol: number): boolean => {
      this.adv(lexer);
      this.mrkEnd(lexer);
      return this.ret(lexer, symbol);
    };
    /** The first of the r/br/b variants of a token that is valid here, or -1. */
    const pick = (r: number, br: number, b: number): number =>
      r >= 0 && valid[r] && isR ? r : br >= 0 && valid[br] && isBr ? br : b >= 0 && valid[b] && isB ? b : -1;

    if (valid[T.R_DIR_YML_VER] && isR) return this.scnDirYmlVer(lexer, T.R_DIR_YML_VER);
    if (valid[T.R_DIR_TAG_HDL] && isR) return this.scnDirTagHdl(lexer, T.R_DIR_TAG_HDL);
    if (valid[T.R_DIR_TAG_PFX] && isR) return this.scnDirTagPfx(lexer, T.R_DIR_TAG_PFX);
    if (valid[T.R_DIR_RSV_PRM] && isR) return this.scnDirRsvPrm(lexer, T.R_DIR_RSV_PRM);
    if (valid[T.BR_BLK_STR_CTN] && isBr && this.scnBlkStrCnt(lexer, T.BR_BLK_STR_CTN)) return true;

    if (
      (valid[T.R_DQT_STR_CTN] && isR && this.scnQtStrCnt(lexer, isNbDoubleChar, T.R_DQT_STR_CTN)) ||
      (valid[T.BR_DQT_STR_CTN] && isBr && this.scnQtStrCnt(lexer, isNbDoubleChar, T.BR_DQT_STR_CTN))
    )
      return true;
    if (
      (valid[T.R_SQT_STR_CTN] && isR && this.scnQtStrCnt(lexer, isNbSingleChar, T.R_SQT_STR_CTN)) ||
      (valid[T.BR_SQT_STR_CTN] && isBr && this.scnQtStrCnt(lexer, isNbSingleChar, T.BR_SQT_STR_CTN))
    )
      return true;

    if (valid[T.R_ACR_CTN] && isR) return this.scnPropCtn(lexer, T.R_ACR_CTN);
    if (valid[T.R_ALS_CTN] && isR) return this.scnPropCtn(lexer, T.R_ALS_CTN);

    switch (lexer.lookahead) {
      case 37: // %
        if (valid[T.S_DIR_YML_BGN] && isS) return this.scnDirBgn(lexer);
        break;
      case 42: // *
      case 38: {
        // &
        const als = lexer.lookahead === 42;
        const s = als
          ? pick(T.R_ALS_BGN, T.BR_ALS_BGN, T.B_ALS_BGN)
          : pick(T.R_ACR_BGN, T.BR_ACR_BGN, T.B_ACR_BGN);
        if (s >= 0) {
          updImpCol();
          return this.scnPropBgn(lexer, als ? 42 : 38, s);
        }
        break;
      }
      case 33: {
        // !
        const s = pick(T.R_TAG, T.BR_TAG, T.B_TAG);
        if (s >= 0) {
          updImpCol();
          return this.scnTag(lexer, s);
        }
        break;
      }
      case 91: {
        // [
        const s = pick(T.R_FLW_SEQ_BGN, T.BR_FLW_SEQ_BGN, T.B_FLW_SEQ_BGN);
        if (s >= 0) {
          updImpCol();
          return single(s);
        }
        break;
      }
      case 93: {
        // ]  (a `b` end returns the `br` symbol, as scanner.c does)
        const s = pick(T.R_FLW_SEQ_END, T.BR_FLW_SEQ_END, T.B_FLW_SEQ_END);
        if (s >= 0) return single(s === T.B_FLW_SEQ_END ? T.BR_FLW_SEQ_END : s);
        break;
      }
      case 123: {
        // {
        const s = pick(T.R_FLW_MAP_BGN, T.BR_FLW_MAP_BGN, T.B_FLW_MAP_BGN);
        if (s >= 0) {
          updImpCol();
          return single(s);
        }
        break;
      }
      case 125: {
        // }
        const s = pick(T.R_FLW_MAP_END, T.BR_FLW_MAP_END, T.B_FLW_MAP_END);
        if (s >= 0) return single(s === T.B_FLW_MAP_END ? T.BR_FLW_MAP_END : s);
        break;
      }
      case 44: {
        // ,
        const s = pick(T.R_FLW_SEP_BGN, T.BR_FLW_SEP_BGN, -1);
        if (s >= 0) return single(s);
        break;
      }
      case 34: {
        // "
        const bgn = pick(T.R_DQT_STR_BGN, T.BR_DQT_STR_BGN, T.B_DQT_STR_BGN);
        if (bgn >= 0) {
          updImpCol();
          return single(bgn);
        }
        const end = pick(T.R_DQT_STR_END, T.BR_DQT_STR_END, -1);
        if (end >= 0) return single(end);
        break;
      }
      case 39: {
        // '
        const bgn = pick(T.R_SQT_STR_BGN, T.BR_SQT_STR_BGN, T.B_SQT_STR_BGN);
        if (bgn >= 0) {
          updImpCol();
          return single(bgn);
        }
        const end = pick(T.R_SQT_STR_END, T.BR_SQT_STR_END, -1);
        if (end >= 0) {
          this.adv(lexer);
          if (lexer.lookahead === 39) {
            this.adv(lexer);
            this.mrkEnd(lexer);
            return this.ret(lexer, end === T.R_SQT_STR_END ? T.R_SQT_ESC_SQT : T.BR_SQT_ESC_SQT);
          }
          this.mrkEnd(lexer);
          return this.ret(lexer, end);
        }
        break;
      }
      case 63: {
        // ?
        const rBlk = valid[T.R_BLK_KEY_BGN] && isR;
        const brBlk = valid[T.BR_BLK_KEY_BGN] && isBr;
        const bBlk = valid[T.B_BLK_KEY_BGN] && isB;
        const rFlw = valid[T.R_FLW_KEY_BGN] && isR;
        const brFlw = valid[T.BR_FLW_KEY_BGN] && isBr;
        if (rBlk || brBlk || bBlk || rFlw || brFlw) {
          this.adv(lexer);
          if (isWht(lexer.lookahead)) {
            this.mrkEnd(lexer);
            if (rBlk) {
              pushBgnInd(IND_MAP);
              return this.ret(lexer, T.R_BLK_KEY_BGN);
            }
            if (brBlk) {
              pushBgnInd(IND_MAP);
              return this.ret(lexer, T.BR_BLK_KEY_BGN);
            }
            if (bBlk) return this.ret(lexer, T.B_BLK_KEY_BGN);
            if (rFlw) return this.ret(lexer, T.R_FLW_KEY_BGN);
            return this.ret(lexer, T.BR_FLW_KEY_BGN);
          }
        }
        break;
      }
      case 58: {
        // :
        if (valid[T.R_FLW_JSV_BGN] && isR) return single(T.R_FLW_JSV_BGN);
        if (valid[T.BR_FLW_JSV_BGN] && isBr) return single(T.BR_FLW_JSV_BGN);
        const rBlkVal = valid[T.R_BLK_VAL_BGN] && isR;
        const brBlkVal = valid[T.BR_BLK_VAL_BGN] && isBr;
        const bBlkVal = valid[T.B_BLK_VAL_BGN] && isB;
        const rBlkImp = valid[T.R_BLK_IMP_BGN] && isR;
        const rFlwNjv = valid[T.R_FLW_NJV_BGN] && isR;
        const brFlwNjv = valid[T.BR_FLW_NJV_BGN] && isBr;
        if (rBlkVal || brBlkVal || bBlkVal || rBlkImp || rFlwNjv || brFlwNjv) {
          this.adv(lexer);
          const isLkaWht = isWht(lexer.lookahead);
          if (isLkaWht) {
            if (rBlkVal || brBlkVal) {
              pushBgnInd(IND_MAP);
              this.mrkEnd(lexer);
              return this.ret(lexer, rBlkVal ? T.R_BLK_VAL_BGN : T.BR_BLK_VAL_BGN);
            }
            if (bBlkVal) {
              this.mrkEnd(lexer);
              return this.ret(lexer, T.B_BLK_VAL_BGN);
            }
            if (rBlkImp) {
              // MAY_PUSH_IMP_IND
              if (curInd !== this.blkImpCol) {
                if (this.blkImpTab) return false;
                this.pushInd(IND_MAP, this.blkImpCol);
              }
              this.mrkEnd(lexer);
              return this.ret(lexer, T.R_BLK_IMP_BGN);
            }
          }
          const la = lexer.lookahead as number;
          if (isLkaWht || la === 44 || la === 93 || la === 125) {
            if (rFlwNjv) {
              this.mrkEnd(lexer);
              return this.ret(lexer, T.R_FLW_NJV_BGN);
            }
            if (brFlwNjv) {
              this.mrkEnd(lexer);
              return this.ret(lexer, T.BR_FLW_NJV_BGN);
            }
          }
        }
        break;
      }
      case 45: {
        // -
        const rSeq = valid[T.R_BLK_SEQ_BGN] && isR;
        const brSeq = valid[T.BR_BLK_SEQ_BGN] && isBr;
        const bSeq = valid[T.B_BLK_SEQ_BGN] && isB;
        if (rSeq || brSeq || bSeq || isS) {
          this.adv(lexer);
          if (isWht(lexer.lookahead)) {
            if (rSeq || brSeq) {
              pushBgnInd(IND_SEQ);
              this.mrkEnd(lexer);
              return this.ret(lexer, rSeq ? T.R_BLK_SEQ_BGN : T.BR_BLK_SEQ_BGN);
            }
            if (bSeq) {
              // MAY_PUSH_SPC_SEQ_IND
              if (curIndTyp === IND_MAP) this.pushInd(IND_SEQ, bgnCol);
              this.mrkEnd(lexer);
              return this.ret(lexer, T.B_BLK_SEQ_BGN);
            }
          } else if (lexer.lookahead === 45 && isS) {
            this.adv(lexer);
            if (lexer.lookahead === 45) {
              this.adv(lexer);
              if (isWht(lexer.lookahead)) {
                if (valid[T.BL]) {
                  this.popInd();
                  return this.ret(lexer, T.BL);
                }
                this.mrkEnd(lexer);
                return this.ret(lexer, T.S_DRS_END);
              }
            }
          }
        }
        break;
      }
      case 46: // .
        if (isS) {
          this.adv(lexer);
          if (lexer.lookahead === 46) {
            this.adv(lexer);
            if (lexer.lookahead === 46) {
              this.adv(lexer);
              if (isWht(lexer.lookahead)) {
                if (valid[T.BL]) {
                  this.popInd();
                  return this.ret(lexer, T.BL);
                }
                this.mrkEnd(lexer);
                return this.ret(lexer, T.S_DOC_END);
              }
            }
          }
        }
        break;
      case 92: {
        // backslash
        const rNwl = valid[T.R_DQT_ESC_NWL] && isR;
        const brNwl = valid[T.BR_DQT_ESC_NWL] && isBr;
        const rSeq = valid[T.R_DQT_ESC_SEQ] && isR;
        const brSeq = valid[T.BR_DQT_ESC_SEQ] && isBr;
        if (rNwl || brNwl || rSeq || brSeq) {
          this.adv(lexer);
          if (isNwl(lexer.lookahead)) {
            if (rNwl || brNwl) {
              this.mrkEnd(lexer);
              return this.ret(lexer, rNwl ? T.R_DQT_ESC_NWL : T.BR_DQT_ESC_NWL);
            }
          }
          if (rSeq) return this.scnDqtEscSeq(lexer, T.R_DQT_ESC_SEQ);
          if (brSeq) return this.scnDqtEscSeq(lexer, T.BR_DQT_ESC_SEQ);
          return false;
        }
        break;
      }
      case 124: {
        // |
        const s = pick(T.R_BLK_LIT_BGN, T.BR_BLK_LIT_BGN, -1);
        if (s >= 0) return this.scnBlkStrBgn(lexer, s);
        break;
      }
      case 62: {
        // >
        const s = pick(T.R_BLK_FLD_BGN, T.BR_BLK_FLD_BGN, -1);
        if (s >= 0) return this.scnBlkStrBgn(lexer, s);
        break;
      }
    }

    const maybeSglPlnBlk =
      (valid[T.R_SGL_PLN_STR_BLK] && isR) || (valid[T.BR_SGL_PLN_STR_BLK] && isBr) || (valid[T.B_SGL_PLN_STR_BLK] && isB);
    const maybeSglPlnFlw = (valid[T.R_SGL_PLN_STR_FLW] && isR) || (valid[T.BR_SGL_PLN_STR_FLW] && isBr);
    const maybeMtlPlnBlk = (valid[T.R_MTL_PLN_STR_BLK] && isR) || (valid[T.BR_MTL_PLN_STR_BLK] && isBr);
    const maybeMtlPlnFlw = (valid[T.R_MTL_PLN_STR_FLW] && isR) || (valid[T.BR_MTL_PLN_STR_FLW] && isBr);

    if (maybeSglPlnBlk || maybeSglPlnFlw || maybeMtlPlnBlk || maybeMtlPlnFlw) {
      const isInBlk = maybeSglPlnBlk || maybeMtlPlnBlk;
      const isPlainSafe = isInBlk ? isPlainSafeInBlock : isPlainSafeInFlow;
      if (this.curCol - bgnCol === 0) this.adv(lexer);
      if (this.curCol - bgnCol === 1) {
        const isPlainFirst =
          (isNsChar(bgnChr) && !isCIndicator(bgnChr)) ||
          ((bgnChr === 45 || bgnChr === 63 || bgnChr === 58) && isPlainSafe(lexer.lookahead));
        if (!isPlainFirst) return false;
        this.advSch();
      } else {
        // `..X`, `...X`, `--X`, `---X`: must be a str.
        this.schStt = SCH_STT_FRZ;
      }

      this.mrkEnd(lexer);

      for (;;) {
        if (!isNwl(lexer.lookahead) && this.scnPlnCnt(lexer, isPlainSafe) !== SCN_SUCC) break;
        if (lexer.lookahead === 0 || !isNwl(lexer.lookahead)) break;
        for (;;) {
          if (isNwl(lexer.lookahead)) this.advNwl(lexer);
          else if (isWsp(lexer.lookahead)) this.adv(lexer);
          else break;
        }
        if (lexer.lookahead === 0 || this.curCol <= curInd) break;
        if (this.curCol === 0 && this.scnDrsDocEnd(lexer)) break;
      }

      if (this.endRow === bgnRow) {
        if (maybeSglPlnBlk) {
          updImpCol();
          return this.ret(
            lexer,
            isR ? this.sglPlnSym("R", "BLK") : isBr ? this.sglPlnSym("BR", "BLK") : this.sglPlnSym("B", "BLK"),
          );
        }
        if (maybeSglPlnFlw) return this.ret(lexer, isR ? this.sglPlnSym("R", "FLW") : this.sglPlnSym("BR", "FLW"));
      } else {
        if (maybeMtlPlnBlk) {
          updImpCol();
          return this.ret(lexer, isR ? T.R_MTL_PLN_STR_BLK : T.BR_MTL_PLN_STR_BLK);
        }
        if (maybeMtlPlnFlw) return this.ret(lexer, isR ? T.R_MTL_PLN_STR_FLW : T.BR_MTL_PLN_STR_FLW);
      }
      return false;
    }

    return !valid[T.ERR_REC];
  }

  serialize(buffer: Uint8Array): number {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let size = 0;
    for (const v of [this.row, this.col, this.blkImpRow, this.blkImpCol, this.blkImpTab]) {
      view.setInt16(size, v, true);
      size += 2;
    }
    for (let i = 1; i < this.indTypStk.length && size < SERIALIZATION_BUFFER_SIZE; i++) {
      view.setInt16(size, this.indTypStk[i] as number, true);
      size += 2;
      view.setInt16(size, this.indLenStk[i] as number, true);
      size += 2;
    }
    return size;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    this.row = 0;
    this.col = 0;
    this.blkImpRow = -1;
    this.blkImpCol = -1;
    this.blkImpTab = 0;
    this.indTypStk = [IND_ROT];
    this.indLenStk = [-1];
    if (length === 0) return;
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let size = 0;
    const next = () => {
      const v = view.getInt16(size, true);
      size += 2;
      return v;
    };
    this.row = next();
    this.col = next();
    this.blkImpRow = next();
    this.blkImpCol = next();
    this.blkImpTab = next();
    while (size < length) {
      this.indTypStk.push(next());
      this.indLenStk.push(next());
    }
  }
}

export function createScanner(): ExternalScanner {
  return new YamlScanner();
}
