// The <wctype.h> the grammar scanners call. web-tree-sitter links them against musl, whose alphabetic set
// differs from JS Unicode properties (musl counts U+0660 as alphabetic and U+0363 as not), so each function
// reproduces musl exactly; wctype.test.ts checks every code point against web-tree-sitter.wasm.
import { setContains } from "./language.js";
import { MUSL_ALPHA } from "./musl-alpha.js";

export function iswspace(c: number): boolean {
  return (
    (c >= 9 && c <= 13) ||
    c === 32 ||
    c === 0x85 ||
    (c >= 0x2000 && c <= 0x200a && c !== 0x2007) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x205f ||
    c === 0x3000
  );
}

export function iswdigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

export function iswalpha(c: number): boolean {
  return setContains(MUSL_ALPHA, c);
}

export function iswalnum(c: number): boolean {
  return iswdigit(c) || iswalpha(c);
}
