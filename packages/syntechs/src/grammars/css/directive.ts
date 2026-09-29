/**
 * The at-rules whose prelude prettier parses as a value (Sass's control flow, mixins and functions, and
 * postcss-mixins'), by their case-sensitive name: read by format.ts's layouts and by fmt.ts's value math.
 */
export const directives = ["if", "else", "for", "each", "while", "debug", "mixin", "include", "function", "return"]
  .concat(["define-mixin", "add-mixin"])
  .map((n) => `@${n}`);
