/**
 * Classic scripts that fill `globalThis.hihyouGrammarModules` for app.js, in dependency-sized groups that stay
 * below AMO's per-file limit. Each is injected on its own, the first time a file needs one of its grammars.
 */
export const grammarChunkFiles = [
  "/grammars-web.js",
  "/grammars-other.js",
  "/grammars-kotlin.js",
  "/grammars-swift.js",
  "/grammars-ruby.js",
  "/grammars-bash.js",
  "/grammars-dockerfile.js",
  "/grammars-sql.js",
  "/grammars-markdown.js",
] as const;

/** What the content script asks the background worker for. */
export type ToBackground =
  | { type: "fetch"; url: string; accept?: string }
  /** Inject app.js (the engine and the renderer, ~5 MB) into the asking frame, once it is first needed. */
  | { type: "load-app" }
  /** Inject one of `grammarChunkFiles` into the asking frame. */
  | { type: "load-grammars"; file: string };

/** The body travels as base64: Chrome passes messages as JSON, and a raw file's bytes must arrive unchanged. */
export type FetchReply =
  | {
      ok: true;
      status: number;
      statusText: string;
      body: string;
      link?: string;
    }
  | { ok: false; error: string };

export type LoadReply = { ok: true } | { ok: false; error: string };

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
