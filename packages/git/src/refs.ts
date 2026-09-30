import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Sha } from "./objects.js";

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
    private readonly gitDir: string,
    private readonly commonDir: string,
  ) {}

  head(): Head {
    const raw = this.readLoose("HEAD");
    if (raw?.startsWith("ref: ")) {
      const branch = raw.slice(5);
      return { sha: this.resolve(branch), branch };
    }
    return { sha: raw && hex40.test(raw) ? raw : undefined, branch: undefined };
  }

  /** The id a ref name stores, following symbolic refs; undefined when no such ref exists. */
  resolve(name: string): Sha | undefined {
    for (let depth = 0; depth < 8; depth++) {
      const raw = this.readLoose(name);
      if (raw === undefined) return this.packedRefs().get(name);
      if (!raw.startsWith("ref: ")) {
        const sha = raw.slice(0, 40);
        return hex40.test(sha) ? sha : undefined;
      }
      name = raw.slice(5).trim();
    }
    return undefined;
  }

  list(): Ref[] {
    const all = new Map(this.packedRefs());
    const walk = (dir: string, prefix: string) => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        const full = `${prefix}/${name}`;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, full);
        else {
          const raw = this.readLoose(full);
          // A symbolic ref such as refs/remotes/origin/HEAD repeats a branch already listed.
          if (raw && hex40.test(raw)) all.set(full, raw);
        }
      }
    };
    walk(join(this.commonDir, "refs"), "refs");
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

  private readLoose(name: string): string | undefined {
    try {
      return readFileSync(join(this.dirOf(name), name), "utf8").trim();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR")
        return undefined;
      throw error;
    }
  }

  /** `packed-refs`, re-read only when the file's mtime changes. */
  private packedRefs(): Map<string, Sha> {
    const path = join(this.commonDir, "packed-refs");
    let stamp: number;
    try {
      stamp = statSync(path).mtimeMs;
    } catch {
      stamp = 0;
    }
    if (this.packed && stamp === this.packedStamp) return this.packed;
    const refs = new Map<string, Sha>();
    if (stamp !== 0)
      for (const line of readFileSync(path, "utf8").split("\n")) {
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
