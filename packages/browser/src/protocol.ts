/** What the content script asks the background worker for. */
export type ToBackground =
  | { type: "fetch"; url: string; accept?: string }
  /** Inject app.js (the engine and the renderer, ~5 MB) into the asking frame, once it is first needed. */
  | { type: "load-app" };

/** The body travels as base64: Chrome passes messages as JSON, and a raw file's bytes must arrive unchanged. */
export type FetchReply =
  | { ok: true; status: number; statusText: string; body: string }
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
