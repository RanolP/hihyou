import { concat, toHex } from "./bytes.js";
import type { FileSystem, GitIO } from "./io.js";
import { openRepo, type Repo } from "./repo.js";

// The two web platform APIs this adapter uses, declared here because the core compiles without DOM types.
interface ByteReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
}
interface ByteWriter {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
declare const DecompressionStream: new (format: "deflate") => {
  readonly writable: { getWriter(): ByteWriter };
  readonly readable: { getReader(): ByteReader };
};
declare const crypto: {
  subtle: {
    digest(algorithm: "SHA-1", data: Uint8Array): Promise<ArrayBuffer>;
  };
};

/**
 * Callers must pass exactly one zlib stream: DecompressionStream rejects bytes after the stream's end
 * ("Trailing junk found after the end of the compressed stream" in Node 24), where node:zlib ignores them.
 */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const writing = writer.write(bytes).then(() => writer.close());
  // Its failure is the same one the reader reports.
  writing.catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  await writing;
  return chunks.length === 1 ? (chunks[0] as Uint8Array) : concat(chunks);
}

async function sha1(bytes: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)));
}

/** `GitIO` over the web platform's DecompressionStream and SubtleCrypto, with the caller's file system. */
export function webIO(fs: FileSystem): GitIO {
  return { fs, inflate, sha1 };
}

/**
 * The repository containing `path` in a browser or web worker. `fs` maps git's absolute `/`-separated
 * paths onto the host's storage; a VS Code web extension wraps `vscode.workspace.fs`, taking each path
 * as a `Uri` path on the workspace folder's scheme.
 */
export function webRepo(options: {
  fs: FileSystem;
  path: string;
}): Promise<Repo> {
  return openRepo(options.path, webIO(options.fs));
}
