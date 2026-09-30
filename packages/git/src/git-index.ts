import { concat, latin1, toHex, u16, u32, utf8 } from "./bytes.js";
import type { Sha } from "./objects.js";

/** One entry of `.git/index`: https://git-scm.com/docs/index-format */
export interface IndexEntry {
  path: string;
  sha: Sha;
  mode: number;
  /** 0 when merged; 1–3 for the base, ours and theirs of a conflict. */
  stage: number;
  ctimeSec: number;
  ctimeNsec: number;
  mtimeSec: number;
  mtimeNsec: number;
  dev: number;
  ino: number;
  /** File size truncated to 32 bits, as git stores it. */
  size: number;
  assumeValid: boolean;
  skipWorktree: boolean;
  intentToAdd: boolean;
}

/** Entries of an index of version 2, 3 or 4. Extensions (cache tree, untracked cache, …) are skipped. */
export function parseIndex(buf: Uint8Array): IndexEntry[] {
  if (latin1(buf, 0, 4) !== "DIRC") throw new Error("index: bad signature");
  const version = u32(buf, 4);
  if (version < 2 || version > 4)
    throw new Error(`index: unsupported version ${version}`);
  const count = u32(buf, 8);
  const entries: IndexEntry[] = [];
  let p = 12;
  let previous: Uint8Array = new Uint8Array(0);
  for (let n = 0; n < count; n++) {
    const start = p;
    const flags = u16(buf, p + 60);
    const extended = version >= 3 && (flags & 0x4000) !== 0;
    const extra = extended ? u16(buf, p + 62) : 0;
    p += extended ? 64 : 62;
    let name: Uint8Array;
    if (version === 4) {
      let c = buf[p++] as number;
      let strip = c & 0x7f;
      while (c & 0x80) {
        c = buf[p++] as number;
        strip = ((strip + 1) << 7) | (c & 0x7f);
      }
      const nul = buf.indexOf(0, p);
      name = concat([
        previous.subarray(0, previous.length - strip),
        buf.subarray(p, nul),
      ]);
      p = nul + 1;
    } else {
      const nul = buf.indexOf(0, p);
      name = buf.subarray(p, nul);
      // NUL-padded so the entry's length is a multiple of 8, with at least one NUL.
      p = start + ((nul - start + 8) & ~7);
    }
    previous = name;
    entries.push({
      path: utf8(name, 0, name.length),
      sha: toHex(buf, start + 40, start + 60),
      mode: u32(buf, start + 24),
      stage: (flags >> 12) & 3,
      ctimeSec: u32(buf, start),
      ctimeNsec: u32(buf, start + 4),
      mtimeSec: u32(buf, start + 8),
      mtimeNsec: u32(buf, start + 12),
      dev: u32(buf, start + 16),
      ino: u32(buf, start + 20),
      size: u32(buf, start + 36),
      assumeValid: (flags & 0x8000) !== 0,
      skipWorktree: (extra & 0x4000) !== 0,
      intentToAdd: (extra & 0x2000) !== 0,
    });
  }
  return entries;
}
