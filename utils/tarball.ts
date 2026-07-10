/**
 * Minimal gzip+tar reader for npm registry tarballs (pure-ish: uses the
 * platform DecompressionStream, available in workers and node 18+).
 */

export interface TarEntry {
  name: string;
  data: Uint8Array;
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function parseTar(bytes: Uint8Array): TarEntry[] {
  const decoder = new TextDecoder();
  const readStr = (off: number, len: number) => {
    const slice = bytes.subarray(off, off + len);
    const end = slice.indexOf(0);
    return decoder.decode(end === -1 ? slice : slice.subarray(0, end));
  };
  const entries: TarEntry[] = [];
  let off = 0;
  while (off + 512 <= bytes.length) {
    const name = readStr(off, 100);
    if (!name) break;
    const size = parseInt(readStr(off + 124, 12).trim() || '0', 8);
    const type = readStr(off + 156, 1);
    const prefix = readStr(off + 345, 155);
    const full = prefix ? `${prefix}/${name}` : name;
    off += 512;
    if (type === '' || type === '0') {
      entries.push({ name: full, data: bytes.slice(off, off + size) });
    }
    off += Math.ceil(size / 512) * 512;
  }
  return entries;
}

/** npm tarballs prefix every path with `package/`. */
export async function extractTypesFromTarball(
  tgz: Uint8Array,
): Promise<Record<string, string>> {
  const decoder = new TextDecoder();
  const out: Record<string, string> = {};
  for (const entry of parseTar(await gunzip(tgz))) {
    const rel = entry.name.replace(/^[^/]+\//, '');
    if (rel === 'package.json' || /\.d\.[cm]?ts$/.test(rel)) {
      out[rel] = decoder.decode(entry.data);
    }
  }
  return out;
}
