// Byte helpers over plain Uint8Array, which both runtimes share; Node's Buffer is not available in a browser.

const hexDigits = "0123456789abcdef";
const digitCode = Uint8Array.from(hexDigits, (c) => c.charCodeAt(0));
const digitValue = new Uint8Array(128);
for (let i = 0; i < 16; i++) {
  digitValue[hexDigits.charCodeAt(i)] = i;
  digitValue[hexDigits.toUpperCase().charCodeAt(i)] = i;
}

/** Lowercase hex, decoded from its character codes so the id is a flat string (see `utf8`). */
export function toHex(
  bytes: Uint8Array,
  start = 0,
  end = bytes.length,
): string {
  const codes = new Uint8Array((end - start) * 2);
  for (let i = start, o = 0; i < end; i++, o += 2) {
    const b = bytes[i] as number;
    codes[o] = digitCode[b >> 4] as number;
    codes[o + 1] = digitCode[b & 15] as number;
  }
  return decoder.decode(codes);
}

/** Expects valid hex digits; anything else reads as zero. */
export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++)
    out[i] =
      ((digitValue[hex.charCodeAt(2 * i)] as number) << 4) |
      (digitValue[hex.charCodeAt(2 * i + 1)] as number);
  return out;
}

export const u32 = (b: Uint8Array, at: number) =>
  (((b[at] as number) << 24) |
    ((b[at + 1] as number) << 16) |
    ((b[at + 2] as number) << 8) |
    (b[at + 3] as number)) >>>
  0;

export const u16 = (b: Uint8Array, at: number) =>
  ((b[at] as number) << 8) | (b[at + 1] as number);

/** Compares `a[0..20)` with `b[at..at+20)`, as `Buffer.compare` would. */
export function compare20(a: Uint8Array, b: Uint8Array, at: number): number {
  for (let i = 0; i < 20; i++) {
    const d = (a[i] as number) - (b[at + i] as number);
    if (d !== 0) return d;
  }
  return 0;
}

export function latin1(b: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(b[i] as number);
  return s;
}

const decoder = new TextDecoder();

/**
 * Past V8's 12-character threshold, appending a character at a time builds a rope rather than a flat
 * string, and every Map lookup keyed by a path or id then pays to flatten it; the decoder builds flat.
 * Below it the loop is cheaper than the call into the decoder.
 */
const flatUpTo = 12;

export function utf8(b: Uint8Array, start: number, end: number): string {
  if (end - start > flatUpTo) return decoder.decode(b.subarray(start, end));
  let s = "";
  for (let i = start; i < end; i++) {
    const c = b[i] as number;
    if (c >= 0x80) return decoder.decode(b.subarray(start, end));
    s += String.fromCharCode(c);
  }
  return s;
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const p of parts) size += p.length;
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
