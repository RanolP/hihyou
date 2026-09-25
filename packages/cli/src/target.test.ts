import type { Vcs } from "@hihyou/engine";
import { describe, expect, it } from "vitest";
import { type Exec, exec } from "./exec.js";
import { parseTarget, resolveTarget } from "./target.js";

/** A Vcs whose ids are the expressions themselves, logging each call so ordering can be checked. */
function fakeVcs(log: string[]): Vcs {
  return {
    resolve: async (expr) => {
      log.push(`resolve ${expr}`);
      return expr;
    },
    parents: async (id) => [`${id}~1`],
    mergeBase: async (a, b) => `merge-base(${a},${b})`,
    changes: async () => [],
    read: async () => new Uint8Array(),
  };
}

const noExec: Exec = async (command, args) => {
  throw new Error(`unexpected ${command} ${args.join(" ")}`);
};

describe("diffset targets", () => {
  it("with no argument, the last commit is reviewed against its parent", async () => {
    expect(await resolveTarget(parseTarget([]), fakeVcs([]), noExec)).toEqual({
      base: "HEAD~1",
      head: "HEAD",
    });
  });

  it("base...head reviews against the merge-base, while base..head diffs the two tips directly", async () => {
    const vcs = fakeVcs([]);
    expect(
      await resolveTarget(parseTarget(["main...topic"]), vcs, noExec),
    ).toEqual({ base: "merge-base(main,topic)", head: "topic" });
    expect(
      await resolveTarget(parseTarget(["main..topic"]), vcs, noExec),
    ).toEqual({ base: "main", head: "topic" });
  });

  it("a pr argument shaped like an option is rejected before gh can read it as a flag", () => {
    expect(() => parseTarget(["pr", "--web"])).toThrow(/PR number or URL/);
  });

  it("a PR is fetched from the remote that points at its repository before its commits are resolved", async () => {
    const log: string[] = [];
    const fakeExec: Exec = async (command, args) => {
      log.push(`${command} ${args.join(" ")}`);
      if (command === "gh")
        return JSON.stringify({
          number: 7,
          url: "https://github.com/Owner/Repo/pull/7",
          baseRefName: "main",
          baseRefOid: "b".repeat(40),
          headRefOid: "a".repeat(40),
        });
      if (args[0] === "remote")
        return "origin\tgit@github.com:someone/fork.git (fetch)\nupstream\tgit@github.com:owner/repo.git (fetch)\n";
      return "";
    };
    const diffset = await resolveTarget(
      parseTarget(["pr", "7"]),
      fakeVcs(log),
      fakeExec,
    );

    expect(diffset).toEqual({
      base: `merge-base(${"b".repeat(40)},${"a".repeat(40)})`,
      head: "a".repeat(40),
    });
    const fetch = log.findIndex((l) => l.startsWith("git fetch"));
    expect(log[fetch]).toBe(
      "git fetch --no-tags upstream refs/pull/7/head refs/heads/main",
    );
    expect(fetch).toBeLessThan(log.findIndex((l) => l.startsWith("resolve")));
  });
});

describe("exec", () => {
  it("a failing command reports the command line, exit code and stderr, not just a status", async () => {
    await expect(exec("git", ["no-such-subcommand"])).rejects.toThrow(
      /^git no-such-subcommand exited 1: .*no-such-subcommand/,
    );
  });
});
