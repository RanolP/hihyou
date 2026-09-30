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
export function parseIndex(buf: Buffer): IndexEntry[] {
  if (buf.toString("latin1", 0, 4) !== "DIRC")
    throw new Error("index: bad signature");
  const version = buf.readUInt32BE(4);
  if (version < 2 || version > 4)
    throw new Error(`index: unsupported version ${version}`);
  const count = buf.readUInt32BE(8);
  const entries: IndexEntry[] = [];
  let p = 12;
  let previous: Buffer = Buffer.alloc(0);
  for (let n = 0; n < count; n++) {
    const start = p;
    const flags = buf.readUInt16BE(p + 60);
    const extended = version >= 3 && (flags & 0x4000) !== 0;
    const extra = extended ? buf.readUInt16BE(p + 62) : 0;
    p += extended ? 64 : 62;
    let name: Buffer;
    if (version === 4) {
      let c = buf[p++] as number;
      let strip = c & 0x7f;
      while (c & 0x80) {
        c = buf[p++] as number;
        strip = ((strip + 1) << 7) | (c & 0x7f);
      }
      const nul = buf.indexOf(0, p);
      name = Buffer.concat([
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
    entries[n] = {
      path: name.toString("utf8"),
      sha: buf.toString("hex", start + 40, start + 60),
      mode: buf.readUInt32BE(start + 24),
      stage: (flags >> 12) & 3,
      ctimeSec: buf.readUInt32BE(start),
      ctimeNsec: buf.readUInt32BE(start + 4),
      mtimeSec: buf.readUInt32BE(start + 8),
      mtimeNsec: buf.readUInt32BE(start + 12),
      dev: buf.readUInt32BE(start + 16),
      ino: buf.readUInt32BE(start + 20),
      size: buf.readUInt32BE(start + 36),
      assumeValid: (flags & 0x8000) !== 0,
      skipWorktree: (extra & 0x4000) !== 0,
      intentToAdd: (extra & 0x2000) !== 0,
    };
  }
  return entries;
}
