// Port of tree-sitter-yaml 0.7.2 src/schema.core.c, the generated state machine that resolves a plain scalar
// against the YAML 1.2 core schema (null, bool, int, float, else str) one character at a time. Mechanically
// transliterated: character literals became their code points, `*rlt_sch` became `out.rlt`.
/* eslint-disable */

export const SCH_STT_FRZ = -1;
export const RS_STR = 0;
export const RS_INT = 1;
export const RS_NULL = 2;
export const RS_BOOL = 3;
export const RS_FLOAT = 4;

export function advSchStt(sch_stt: number, cur_chr: number, out: { rlt: number }): number {
  switch (sch_stt) {
    case SCH_STT_FRZ:
      break;
    case 0:
        if (cur_chr == 46) {out.rlt = RS_STR; return 6;}
        if (cur_chr == 48) {out.rlt = RS_INT; return 37;}
        if (cur_chr == 70) {out.rlt = RS_STR; return 2;}
        if (cur_chr == 78) {out.rlt = RS_STR; return 16;}
        if (cur_chr == 84) {out.rlt = RS_STR; return 13;}
        if (cur_chr == 102) {out.rlt = RS_STR; return 17;}
        if (cur_chr == 110) {out.rlt = RS_STR; return 29;}
        if (cur_chr == 116) {out.rlt = RS_STR; return 26;}
        if (cur_chr == 126) {out.rlt = RS_NULL; return 35;}
        if (cur_chr == 43) {out.rlt = RS_STR; return 1;}
        if (cur_chr == 45) {out.rlt = RS_STR; return 1;}
        if ((49 <= cur_chr && cur_chr <= 57)) {out.rlt = RS_INT; return 38;}
      break;
    case 1:
      if (cur_chr == 46) {out.rlt = RS_STR; return 7;}
      if ((48 <= cur_chr && cur_chr <= 57)) {out.rlt = RS_INT; return 38;}
      break;
    case 2:
      if (cur_chr == 65) {out.rlt = RS_STR; return 9;}
      if (cur_chr == 97) {out.rlt = RS_STR; return 22;}
      break;
    case 3:
      if (cur_chr == 65) {out.rlt = RS_STR; return 12;}
      if (cur_chr == 97) {out.rlt = RS_STR; return 12;}
      break;
    case 4:
      if (cur_chr == 69) {out.rlt = RS_BOOL; return 36;}
      break;
    case 5:
      if (cur_chr == 70) {out.rlt = RS_FLOAT; return 41;}
      break;
    case 6:
      if (cur_chr == 73) {out.rlt = RS_STR; return 11;}
      if (cur_chr == 78) {out.rlt = RS_STR; return 3;}
      if (cur_chr == 105) {out.rlt = RS_STR; return 24;}
      if (cur_chr == 110) {out.rlt = RS_STR; return 18;}
      if ((48 <= cur_chr && cur_chr <= 57)) {out.rlt = RS_FLOAT; return 42;}
      break;
    case 7:
      if (cur_chr == 73) {out.rlt = RS_STR; return 11;}
      if (cur_chr == 105) {out.rlt = RS_STR; return 24;}
      if ((48 <= cur_chr && cur_chr <= 57)) {out.rlt = RS_FLOAT; return 42;}
      break;
    case 8:
      if (cur_chr == 76) {out.rlt = RS_NULL; return 35;}
      break;
    case 9:
      if (cur_chr == 76) {out.rlt = RS_STR; return 14;}
      break;
    case 10:
      if (cur_chr == 76) {out.rlt = RS_STR; return 8;}
      break;
    case 11:
      if (cur_chr == 78) {out.rlt = RS_STR; return 5;}
      if (cur_chr == 110) {out.rlt = RS_STR; return 20;}
      break;
    case 12:
      if (cur_chr == 78) {out.rlt = RS_FLOAT; return 41;}
      break;
    case 13:
      if (cur_chr == 82) {out.rlt = RS_STR; return 15;}
      if (cur_chr == 114) {out.rlt = RS_STR; return 28;}
      break;
    case 14:
      if (cur_chr == 83) {out.rlt = RS_STR; return 4;}
      break;
    case 15:
      if (cur_chr == 85) {out.rlt = RS_STR; return 4;}
      break;
    case 16:
      if (cur_chr == 85) {out.rlt = RS_STR; return 10;}
      if (cur_chr == 117) {out.rlt = RS_STR; return 23;}
      break;
    case 17:
      if (cur_chr == 97) {out.rlt = RS_STR; return 22;}
      break;
    case 18:
      if (cur_chr == 97) {out.rlt = RS_STR; return 25;}
      break;
    case 19:
      if (cur_chr == 101) {out.rlt = RS_BOOL; return 36;}
      break;
    case 20:
      if (cur_chr == 102) {out.rlt = RS_FLOAT; return 41;}
      break;
    case 21:
      if (cur_chr == 108) {out.rlt = RS_NULL; return 35;}
      break;
    case 22:
      if (cur_chr == 108) {out.rlt = RS_STR; return 27;}
      break;
    case 23:
      if (cur_chr == 108) {out.rlt = RS_STR; return 21;}
      break;
    case 24:
      if (cur_chr == 110) {out.rlt = RS_STR; return 20;}
      break;
    case 25:
      if (cur_chr == 110) {out.rlt = RS_FLOAT; return 41;}
      break;
    case 26:
      if (cur_chr == 114) {out.rlt = RS_STR; return 28;}
      break;
    case 27:
      if (cur_chr == 115) {out.rlt = RS_STR; return 19;}
      break;
    case 28:
      if (cur_chr == 117) {out.rlt = RS_STR; return 19;}
      break;
    case 29:
      if (cur_chr == 117) {out.rlt = RS_STR; return 23;}
      break;
    case 30:
      if (cur_chr == 43 ||
          cur_chr == 45) {out.rlt = RS_STR; return 32;}
      if ((48 <= cur_chr && cur_chr <= 57)) {out.rlt = RS_FLOAT; return 43;}
      break;
    case 31:
      if ((48 <= cur_chr && cur_chr <= 55)) {out.rlt = RS_INT; return 39;}
      break;
    case 32:
      if ((48 <= cur_chr && cur_chr <= 57)) {out.rlt = RS_FLOAT; return 43;}
      break;
    case 33:
      if ((48 <= cur_chr && cur_chr <= 57) ||
          (65 <= cur_chr && cur_chr <= 70) ||
          (97 <= cur_chr && cur_chr <= 102)) {out.rlt = RS_INT; return 40;}
      break;
    case 34:
      throw new Error("adv_sch_stt: unreachable");
      break;
    case 35:
      out.rlt = RS_NULL;
      break;
    case 36:
      out.rlt = RS_BOOL;
      break;
    case 37:
      out.rlt = RS_INT;
      if (cur_chr == 46) {out.rlt = RS_FLOAT; return 42;}
      if (cur_chr == 111) {out.rlt = RS_STR; return 31;}
      if (cur_chr == 120) {out.rlt = RS_STR; return 33;}
      if (cur_chr == 69 ||
          cur_chr == 101) {out.rlt = RS_STR; return 30;}
      if ((48 <= cur_chr && cur_chr <= 57)) {out.rlt = RS_INT; return 38;}
      break;
    case 38:
      out.rlt = RS_INT;
      if (cur_chr == 46) {out.rlt = RS_FLOAT; return 42;}
      if (cur_chr == 69 ||
          cur_chr == 101) {out.rlt = RS_STR; return 30;}
      if ((48 <= cur_chr && cur_chr <= 57)) {out.rlt = RS_INT; return 38;}
      break;
    case 39:
      out.rlt = RS_INT;
      if ((48 <= cur_chr && cur_chr <= 55)) {out.rlt = RS_INT; return 39;}
      break;
    case 40:
      out.rlt = RS_INT;
      if ((48 <= cur_chr && cur_chr <= 57) ||
          (65 <= cur_chr && cur_chr <= 70) ||
          (97 <= cur_chr && cur_chr <= 102)) {out.rlt = RS_INT; return 40;}
      break;
    case 41:
      out.rlt = RS_FLOAT;
      break;
    case 42:
      out.rlt = RS_FLOAT;
      if (cur_chr == 69 ||
          cur_chr == 101) {out.rlt = RS_STR; return 30;}
      if ((48 <= cur_chr && cur_chr <= 57)) {out.rlt = RS_FLOAT; return 42;}
      break;
    case 43:
      out.rlt = RS_FLOAT;
      if ((48 <= cur_chr && cur_chr <= 57)) {out.rlt = RS_FLOAT; return 43;}
      break;
    default:
      out.rlt = RS_STR;
      return SCH_STT_FRZ;
  }
  if (cur_chr != 13 && cur_chr != 10 && cur_chr != 32 && cur_chr != 0) out.rlt = RS_STR;
  return SCH_STT_FRZ;
}
