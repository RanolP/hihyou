import { compare20, fromHex, toHex, u32 } from "./bytes.js";
import type { GitIO } from "./io.js";

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

/** Where entry bytes come from: ranged reads, or the whole pack held in memory. */
interface PackData {
  size: number;
  read(offset: number, length: number): Uint8Array | Promise<Uint8Array>;
  close(): void;
}

/** One `.pack` with its v2 `.idx`: https://git-scm.com/docs/gitformat-pack */
export class Pack {
  readonly count: number;
  private data: Promise<PackData> | undefined;
  private sortedOffsets: Float64Array | undefined;
  private readonly bases = new Map<number, GitObject>();
  private baseBytes = 0;
  private readonly shaStart = 8 + 256 * 4;
  private readonly offsetStart: number;
  private readonly largeStart: number;

  constructor(
    private readonly io: GitIO,
    readonly packPath: string,
    private readonly idx: Uint8Array,
  ) {
    if (u32(idx, 0) !== 0xff744f63 || u32(idx, 4) !== 2)
      throw new Error(`${packPath}: only pack index version 2 is supported`);
    this.count = u32(idx, 8 + 255 * 4);
    this.offsetStart = this.shaStart + this.count * 24;
    this.largeStart = this.offsetStart + this.count * 4;
  }

  static async open(
    io: GitIO,
    idxPath: string,
    packPath: string,
  ): Promise<Pack> {
    const idx = await io.fs.readFile(idxPath);
    if (!idx) throw new Error(`${idxPath}: not found`);
    return new Pack(io, packPath, idx);
  }

  close(): void {
    const data = this.data;
    this.data = undefined;
    data?.then(
      (d) => d.close(),
      () => {},
    );
  }

  /** Position of `sha` (20 raw bytes) in the index, or -1. */
  find(sha: Uint8Array): number {
    const first = sha[0] as number;
    let lo = first === 0 ? 0 : this.fanout(first - 1);
    let hi = this.fanout(first);
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const c = compare20(sha, this.idx, this.shaStart + mid * 20);
      if (c === 0) return mid;
      if (c < 0) hi = mid;
      else lo = mid + 1;
    }
    return -1;
  }

  /** Every object whose hex SHA starts with `prefix`, stopping after `limit`. */
  findPrefix(prefix: string, limit: number): string[] {
    const low = fromHex(prefix.padEnd(40, "0"));
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compare20(low, this.idx, this.shaStart + mid * 20) > 0) lo = mid + 1;
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
    return toHex(this.idx, at, at + 20);
  }

  offsetAt(i: number): number {
    const v = u32(this.idx, this.offsetStart + i * 4);
    if (!(v & 0x80000000)) return v;
    const at = this.largeStart + (v & 0x7fffffff) * 8;
    return u32(this.idx, at) * 0x100000000 + u32(this.idx, at + 4);
  }

  /**
   * The object at `offset`, with deltas applied. A REF_DELTA base outside this pack is read through
   * `external`, since a thin pack's bases may live in another pack or as loose objects.
   */
  async read(
    offset: number,
    external: (sha: string) => Promise<GitObject>,
  ): Promise<GitObject> {
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
      const entry = await this.entry(at);
      if (entry.type === OFS_DELTA || entry.type === REF_DELTA) {
        chain.push(entry.data);
        chainAt.push(at);
        if (typeof entry.base === "number") {
          at = entry.base;
          continue;
        }
        const sha = entry.base as string;
        const i = this.find(fromHex(sha));
        if (i >= 0) {
          at = this.offsetAt(i);
          continue;
        }
        base = await external(sha);
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
    return u32(this.idx, 8 + byte * 4);
  }

  private async entry(offset: number): Promise<{
    type: number;
    base?: number | string;
    data: Uint8Array;
  }> {
    const pack = await (this.data ??= this.load());
    const end = this.entryEnd(offset, pack.size);
    const buf = await pack.read(offset, end - offset);
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
      base = toHex(buf, p, p + 20);
      p += 20;
    }
    // Bounded by the next entry, the bytes hold exactly one zlib stream, which a browser's
    // DecompressionStream requires: it rejects any bytes after the stream's end.
    const data = await this.io.inflate(buf.subarray(p), size);
    return base === undefined ? { type, data } : { type, base, data };
  }

  private async load(): Promise<PackData> {
    const { fs } = this.io;
    if (fs.openFile) {
      const file = await fs.openFile(this.packPath);
      return {
        size: file.size,
        read: (offset, length) => file.read(offset, length),
        close: () => file.close(),
      };
    }
    const whole = await fs.readFile(this.packPath);
    if (!whole) throw new Error(`${this.packPath}: not found`);
    return {
      size: whole.length,
      read: (offset, length) => whole.subarray(offset, offset + length),
      close: () => {},
    };
  }

  /** An entry's compressed bytes end where the next entry starts, or at the pack's 20-byte trailer. */
  private entryEnd(offset: number, packSize: number): number {
    if (!this.sortedOffsets) {
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
    return sorted[lo] ?? packSize - 20;
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
