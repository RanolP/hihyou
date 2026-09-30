import {
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import { inflateSync } from "node:zlib";

export type ObjectType = "commit" | "tree" | "blob" | "tag";

export interface GitObject {
  type: ObjectType;
  data: Uint8Array;
}

const typeByCode: Record<number, ObjectType> = {
  1: "commit",
  2: "tree",
  3: "blob",
  4: "tag",
};
const OFS_DELTA = 6;
const REF_DELTA = 7;

/** Resolved delta bases kept per pack, so a chain shared by many objects is walked once. */
const baseCacheBytes = 32 * 1024 * 1024;

/** One `.pack` with its v2 `.idx`: https://git-scm.com/docs/gitformat-pack */
export class Pack {
  readonly count: number;
  private fd: number | undefined;
  private packSize = 0;
  private sortedOffsets: Float64Array | undefined;
  private readonly bases = new Map<number, GitObject>();
  private baseBytes = 0;
  private readonly shaStart = 8 + 256 * 4;
  private readonly offsetStart: number;
  private readonly largeStart: number;

  constructor(
    readonly packPath: string,
    private readonly idx: Buffer,
  ) {
    if (idx.readUInt32BE(0) !== 0xff744f63 || idx.readUInt32BE(4) !== 2)
      throw new Error(`${packPath}: only pack index version 2 is supported`);
    this.count = idx.readUInt32BE(8 + 255 * 4);
    this.offsetStart = this.shaStart + this.count * 24;
    this.largeStart = this.offsetStart + this.count * 4;
  }

  static open(idxPath: string, packPath: string): Pack {
    return new Pack(packPath, readFileSync(idxPath));
  }

  close(): void {
    if (this.fd !== undefined) closeSync(this.fd);
    this.fd = undefined;
  }

  /** Position of `sha` (20 raw bytes) in the index, or -1. */
  find(sha: Uint8Array): number {
    const first = sha[0] as number;
    let lo = first === 0 ? 0 : this.fanout(first - 1);
    let hi = this.fanout(first);
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const at = this.shaStart + mid * 20;
      const c = this.idx.compare(sha, 0, 20, at, at + 20);
      if (c === 0) return mid;
      if (c > 0) hi = mid;
      else lo = mid + 1;
    }
    return -1;
  }

  /** Every object whose hex SHA starts with `prefix`, stopping after `limit`. */
  findPrefix(prefix: string, limit: number): string[] {
    const low = Buffer.from(prefix.padEnd(40, "0"), "hex");
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const at = this.shaStart + mid * 20;
      if (this.idx.compare(low, 0, 20, at, at + 20) < 0) lo = mid + 1;
      else hi = mid;
    }
    const out: string[] = [];
    for (let i = lo; i < this.count && out.length < limit; i++) {
      const sha = this.shaAt(i);
      if (!sha.startsWith(prefix)) break;
      out.push(sha);
    }
    return out;
  }

  shaAt(i: number): string {
    const at = this.shaStart + i * 20;
    return this.idx.toString("hex", at, at + 20);
  }

  offsetAt(i: number): number {
    const v = this.idx.readUInt32BE(this.offsetStart + i * 4);
    if (!(v & 0x80000000)) return v;
    return Number(
      this.idx.readBigUInt64BE(this.largeStart + (v & 0x7fffffff) * 8),
    );
  }

  /**
   * The object at `offset`, with deltas applied. A REF_DELTA base outside this pack is read through
   * `external`, since a thin pack's bases may live in another pack or as loose objects.
   */
  read(offset: number, external: (sha: string) => GitObject): GitObject {
    const chain: Uint8Array[] = [];
    const chainAt: number[] = [];
    let at = offset;
    let base: GitObject | undefined;
    for (;;) {
      const cached = this.bases.get(at);
      if (cached) {
        base = cached;
        break;
      }
      const entry = this.entry(at);
      if (entry.type === OFS_DELTA || entry.type === REF_DELTA) {
        chain.push(entry.data);
        chainAt.push(at);
        if (typeof entry.base === "number") {
          at = entry.base;
          continue;
        }
        const sha = entry.base as string;
        const i = this.find(Buffer.from(sha, "hex"));
        if (i >= 0) {
          at = this.offsetAt(i);
          continue;
        }
        base = external(sha);
        break;
      }
      const type = typeByCode[entry.type];
      if (!type)
        throw new Error(
          `${this.packPath}: unknown object type ${entry.type} at ${at}`,
        );
      base = { type, data: entry.data };
      if (chain.length > 0) this.remember(at, base);
      break;
    }
    let obj = base;
    for (let i = chain.length - 1; i >= 0; i--) {
      obj = {
        type: obj.type,
        data: applyDelta(obj.data, chain[i] as Uint8Array),
      };
      if (i > 0) this.remember(chainAt[i] as number, obj);
    }
    return obj;
  }

  private remember(offset: number, obj: GitObject): void {
    if (obj.data.length > baseCacheBytes / 4) return;
    this.bases.set(offset, obj);
    this.baseBytes += obj.data.length;
    for (const [key, value] of this.bases) {
      if (this.baseBytes <= baseCacheBytes) break;
      this.bases.delete(key);
      this.baseBytes -= value.data.length;
    }
  }

  private fanout(byte: number): number {
    return this.idx.readUInt32BE(8 + byte * 4);
  }

  private entry(offset: number): {
    type: number;
    base?: number | string;
    data: Uint8Array;
  } {
    const end = this.entryEnd(offset);
    const buf = Buffer.allocUnsafe(end - offset);
    readSync(this.fd as number, buf, 0, buf.length, offset);
    let p = 0;
    let c = buf[p++] as number;
    const type = (c >> 4) & 7;
    let size = c & 0x0f;
    let shift = 16;
    while (c & 0x80) {
      c = buf[p++] as number;
      size += (c & 0x7f) * shift;
      shift *= 128;
    }
    let base: number | string | undefined;
    if (type === OFS_DELTA) {
      c = buf[p++] as number;
      let back = c & 0x7f;
      while (c & 0x80) {
        c = buf[p++] as number;
        back = (back + 1) * 128 + (c & 0x7f);
      }
      base = offset - back;
    } else if (type === REF_DELTA) {
      base = buf.toString("hex", p, p + 20);
      p += 20;
    }
    // One output chunk of the known size, instead of 16 KiB chunks concatenated afterwards.
    const data = inflateSync(buf.subarray(p), {
      chunkSize: Math.max(64, size + 1),
    });
    return base === undefined ? { type, data } : { type, base, data };
  }

  /** An entry's compressed bytes end where the next entry starts, so it is read in one call. */
  private entryEnd(offset: number): number {
    if (!this.sortedOffsets) {
      this.fd = openSync(this.packPath, "r");
      this.packSize = fstatSync(this.fd).size;
      const offsets = new Float64Array(this.count);
      for (let i = 0; i < this.count; i++) offsets[i] = this.offsetAt(i);
      this.sortedOffsets = offsets.sort();
    }
    const sorted = this.sortedOffsets;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((sorted[mid] as number) <= offset) lo = mid + 1;
      else hi = mid;
    }
    return sorted[lo] ?? this.packSize - 20;
  }
}

/** Below this many bytes a plain loop beats allocating a `subarray` view for `set`. */
const shortCopy = 64;

/**
 * https://git-scm.com/docs/gitformat-pack#_deltified_representation
 *
 * The hot loop of every packed read: source files delta into millions of copy and insert ops of a
 * few bytes each, so each op's fields are decoded unrolled.
 */
export function applyDelta(base: Uint8Array, d: Uint8Array): Uint8Array {
  let p = 0;
  let c: number;
  let baseSize = 0;
  let shift = 1;
  do {
    c = d[p++] as number;
    baseSize += (c & 0x7f) * shift;
    shift *= 128;
  } while (c & 0x80);
  if (baseSize !== base.length) throw new Error("delta: base size mismatch");
  let outSize = 0;
  shift = 1;
  do {
    c = d[p++] as number;
    outSize += (c & 0x7f) * shift;
    shift *= 128;
  } while (c & 0x80);
  const out = new Uint8Array(outSize);
  const end = d.length;
  let o = 0;
  while (p < end) {
    const op = d[p++] as number;
    if (op & 0x80) {
      let from = 0;
      let len = 0;
      if (op & 0x01) from = d[p++] as number;
      if (op & 0x02) from |= (d[p++] as number) << 8;
      if (op & 0x04) from |= (d[p++] as number) << 16;
      if (op & 0x08) from += (d[p++] as number) * 0x1000000;
      if (op & 0x10) len = d[p++] as number;
      if (op & 0x20) len |= (d[p++] as number) << 8;
      if (op & 0x40) len |= (d[p++] as number) << 16;
      if (len === 0) len = 0x10000;
      if (len > shortCopy) out.set(base.subarray(from, from + len), o);
      else for (let i = 0; i < len; i++) out[o + i] = base[from + i] as number;
      o += len;
    } else if (op > 0) {
      if (op > shortCopy) out.set(d.subarray(p, p + op), o);
      else for (let i = 0; i < op; i++) out[o + i] = d[p + i] as number;
      o += op;
      p += op;
    } else {
      throw new Error("delta: reserved opcode 0");
    }
  }
  if (o !== outSize) throw new Error("delta: result size mismatch");
  return out;
}
