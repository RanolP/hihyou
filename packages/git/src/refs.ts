import { type FileSystem, readText } from "./io.js";
import type { Sha } from "./objects.js";
import { join } from "./path.js";

export interface Ref {
  /** Full name, e.g. `refs/heads/main`. */
  name: string;
  /** Name as a quick-pick shows it, e.g. `main`, `origin/main`, `v1.0`. */
  short: string;
  kind: "branch" | "remote" | "tag" | "other";
  /** What the ref stores: an annotated tag's own id, not the commit it names. */
  sha: Sha;
}

export interface Head {
  /** Undefined on an unborn branch (a repository with no commits yet). */
  sha: Sha | undefined;
  /** Full ref name HEAD points at; undefined when detached. */
  branch: string | undefined;
}

const hex40 = /^[0-9a-f]{40}$/;

/**
 * Refs of one worktree: HEAD and `refs/bisect|worktree|rewritten` live in its own git dir, every other
 * ref and `packed-refs` in the common dir shared by all worktrees.
 */
export class RefStore {
  private packed: Map<string, Sha> | undefined;
  private packedStamp = -1;

  constructor(
    private readonly fs: FileSystem,
    private readonly gitDir: string,
    private readonly commonDir: string,
  ) {}

  async head(): Promise<Head> {
    const raw = await this.readLoose("HEAD");
    if (raw?.startsWith("ref: ")) {
      const branch = raw.slice(5);
      return { sha: await this.resolve(branch), branch };
    }
    return { sha: raw && hex40.test(raw) ? raw : undefined, branch: undefined };
  }

  /** The id a ref name stores, following symbolic refs; undefined when no such ref exists. */
  async resolve(name: string): Promise<Sha | undefined> {
    for (let depth = 0; depth < 8; depth++) {
      const raw = await this.readLoose(name);
      if (raw === undefined) return (await this.packedRefs()).get(name);
      if (!raw.startsWith("ref: ")) {
        const sha = raw.slice(0, 40);
        return hex40.test(sha) ? sha : undefined;
      }
      name = raw.slice(5).trim();
    }
    return undefined;
  }

  async list(): Promise<Ref[]> {
    const all = new Map(await this.packedRefs());
    const loose: [string, string | undefined][] = [];
    const walk = async (dir: string, prefix: string): Promise<void> => {
      const entries = (await this.fs.readDir(dir)) ?? [];
      await Promise.all(
        entries.map(async ({ name, type }) => {
          const full = `${prefix}/${name}`;
          if (type === "directory") await walk(join(dir, name), full);
          else loose.push([full, await this.readLoose(full)]);
        }),
      );
    };
    await walk(join(this.commonDir, "refs"), "refs");
    // A symbolic ref such as refs/remotes/origin/HEAD repeats a branch already listed.
    for (const [name, raw] of loose)
      if (raw && hex40.test(raw)) all.set(name, raw);
    return [...all]
      .map(([name, sha]) => ({ name, sha, ...describe(name) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  private dirOf(name: string): string {
    const perWorktree =
      !name.startsWith("refs/") ||
      /^refs\/(?:bisect|worktree|rewritten)\//.test(name);
    return perWorktree ? this.gitDir : this.commonDir;
  }

  private async readLoose(name: string): Promise<string | undefined> {
    return (await readText(this.fs, join(this.dirOf(name), name)))?.trim();
  }

  /** `packed-refs`, re-read only when the file's mtime changes. */
  private async packedRefs(): Promise<Map<string, Sha>> {
    const path = join(this.commonDir, "packed-refs");
    const stamp = (await this.fs.stat(path))?.mtimeMs ?? 0;
    if (this.packed && stamp === this.packedStamp) return this.packed;
    const refs = new Map<string, Sha>();
    const text = stamp === 0 ? undefined : await readText(this.fs, path);
    for (const line of text?.split("\n") ?? []) {
      if (line[0] === "#" || line[0] === "^") continue;
      const space = line.indexOf(" ");
      const sha = line.slice(0, space);
      if (hex40.test(sha)) refs.set(line.slice(space + 1).trim(), sha);
    }
    this.packed = refs;
    this.packedStamp = stamp;
    return refs;
  }
}

function describe(name: string): Pick<Ref, "short" | "kind"> {
  if (name.startsWith("refs/heads/"))
    return { short: name.slice(11), kind: "branch" };
  if (name.startsWith("refs/remotes/"))
    return { short: name.slice(13), kind: "remote" };
  if (name.startsWith("refs/tags/"))
    return { short: name.slice(10), kind: "tag" };
  return { short: name, kind: "other" };
}
