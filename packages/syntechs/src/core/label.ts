// How a leaf's text becomes its diff label, shared by the object tree, the arena and the parity reference.

import type { Language } from "./language.js";

export const LABEL_TOKEN = 0;
export const LABEL_COMMENT = 1;
export const LABEL_JSX_TEXT = 2;

/** Comments and JSX text carry prose, so their whitespace runs collapse; every other token is its text. */
function labelMode(kind: string): number {
  return kind.includes("comment")
    ? LABEL_COMMENT
    : kind === "jsx_text"
      ? LABEL_JSX_TEXT
      : LABEL_TOKEN;
}

const modesOf = new WeakMap<Language, Uint8Array>();

/** `labelMode` by symbol id, raw or public (an id and its public id share a name); ids past the end (ERROR) are plain tokens. */
export function labelModes(lang: Language): Uint8Array {
  let modes = modesOf.get(lang);
  if (modes) return modes;
  modes = new Uint8Array(lang.symbolNames.length);
  for (let s = 0; s < modes.length; s++)
    modes[s] = labelMode(lang.symbolNames[s] as string);
  modesOf.set(lang, modes);
  return modes;
}

export function labelText(mode: number, token: string): string {
  if (mode === LABEL_COMMENT) return token.replace(/\s+/g, " ");
  if (mode === LABEL_JSX_TEXT) return jsxText(token);
  return token;
}

/** JSX text as JSX evaluates it, whitespace runs collapsed; "" means layout only. Mirrors packages/engine. */
export function jsxText(token: string): string {
  const lines = token.split(/\r\n|\n|\r/);
  return lines
    .map((line, i) => {
      let t = line;
      if (i > 0) t = t.trimStart();
      if (i < lines.length - 1) t = t.trimEnd();
      return t;
    })
    .filter((t) => t !== "")
    .join(" ")
    .replace(/\s+/g, " ");
}
