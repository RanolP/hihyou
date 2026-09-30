/**
 * What the reader needs from its runtime. The core imports nothing platform-specific; `@hihyou/git/node`
 * and `@hihyou/git/web` supply these.
 *
 * Paths are absolute and `/`-separated: `/home/me/repo/.git/HEAD`, or `C:/repo/.git/HEAD` on Windows.
 * A browser file system maps them onto its own locations, e.g. as the path of a `vscode.Uri`.
 */
export interface GitIO {
  fs: FileSystem;
  inflate: Inflate;
  sha1: Sha1;
}

export interface FileSystem {
  /** Undefined when no file is there: nothing at all, a directory, or a file where a parent directory should be. */
  readFile(path: string): Promise<Uint8Array | undefined>;
  /** Undefined when `path` is not a directory. */
  readDir(path: string): Promise<DirEntry[] | undefined>;
  /** Of the link itself when `path` is a symbolic link, where the file system can tell; undefined when nothing is there. */
  stat(path: string): Promise<FileStat | undefined>;
  /**
   * A symbolic link's target, as the bytes git stores for it. Without it a link on disk is taken at its
   * index id, since reading through it would return the target file's content instead.
   */
  readLink?(path: string): Promise<Uint8Array>;
  /**
   * Random access into a large file. Without it a packfile is read whole into memory on first use,
   * which is what a file system with no ranged read (such as `vscode.workspace.fs`) has to do.
   */
  openFile?(path: string): Promise<RandomAccessFile>;
}

export type EntryType = "file" | "directory" | "symlink" | "other";

export interface DirEntry {
  name: string;
  type: EntryType;
}

export interface FileStat {
  type: EntryType;
  size: number;
  /** Modification time in whole milliseconds since the epoch. */
  mtimeMs: number;
  /** The exact modification time, as git's index stores it. When absent, only milliseconds are compared. */
  mtime?: { sec: number; nsec: number };
  /** Compared against the index when present. */
  ino?: number;
  /** The owner-executable bit. When absent, a file keeps the mode its index entry has, as with `core.filemode=false`. */
  executable?: boolean;
}

export interface RandomAccessFile {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  close(): void;
}

/**
 * Decompresses one zlib stream (RFC 1950) that fills `bytes` exactly. `size` is the decompressed length
 * when the caller knows it, for preallocating.
 */
export type Inflate = (bytes: Uint8Array, size?: number) => Promise<Uint8Array>;

/** The SHA-1 of `bytes` as 40 lowercase hex digits. */
export type Sha1 = (bytes: Uint8Array) => Promise<string>;

const decoder = new TextDecoder();

export async function readText(
  fs: FileSystem,
  path: string,
): Promise<string | undefined> {
  const bytes = await fs.readFile(path);
  return bytes && decoder.decode(bytes);
}
