// Port of tree-sitter-jsdoc 0.25.0 src/scanner.c. Stateless; `code_block_line` is declared external upstream
// but the C scanner never produces it either.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";

const TYPE = 0;

/** Read through a call so TypeScript does not keep a narrowing across `advance`. */
const la = (lexer: Lexer): number => lexer.lookahead;

/** Scans to the next balanced `}`. */
function scanForType(lexer: Lexer): boolean {
  let stack = 0;
  for (;;) {
    if (lexer.eof()) return false;
    switch (la(lexer)) {
      case 123: // {
        stack++;
        break;
      case 125: // }
        stack--;
        if (stack === -1) return true;
        break;
      case 10:
      case 0:
        return false;
    }
    lexer.advance(false);
  }
}

function scan(lexer: Lexer, valid: Uint8Array): boolean {
  if (valid[TYPE] && scanForType(lexer)) {
    lexer.resultSymbol = TYPE;
    lexer.markEnd();
    return true;
  }
  return false;
}

export function createScanner(): ExternalScanner {
  return { scan, serialize: () => 0, deserialize: () => {} };
}
