// Times @hihyou/git against the git CLI and, when built, libgit2 (bench/rust). Usage:
//   node bench/run.mjs [repo-path] [iterations]
// Reads the compiled dist, so run `tsc -b` first (the `bench` script does).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { openRepo } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const path = resolve(process.argv[2] ?? ".");
const n = Number(process.argv[3] ?? 30);
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_OPTIONAL_LOCKS: "0",
};
const git = (args, input) =>
  execFileSync("git", args, { cwd: path, env, input, maxBuffer: 1 << 28 });

const a = "HEAD~50";
const b = "HEAD";
// Deltified packed blobs, spread over the object list: the costliest read path.
const deltified = git([
  "cat-file",
  "--batch-all-objects",
  "--batch-check=%(objectname) %(objecttype) %(deltabase)",
])
  .toString()
  .split("\n")
  .map((l) => l.split(" "))
  .filter(([, type, base]) => type === "blob" && base && !/^0+$/.test(base))
  .map(([sha]) => sha);
const step = Math.max(1, Math.floor(deltified.length / 200));
const blobs = deltified.filter((_, i) => i % step === 0).slice(0, 200);
const blobInput = blobs.join("\n") + "\n";

const ours = {
  worktree: (r) => r.diffWorktree({ renames: false }),
  treediff: (r) => r.diffRevs(a, b, { renames: false }),
  blobs: (r) => blobs.forEach((s) => r.readBlob(s)),
  revparse: (r) => r.resolveRev("HEAD~20"),
};
const cli = {
  spawn: () => git(["--version"]),
  worktree: () => git(["diff", "--raw", "--no-renames", "HEAD"]),
  status: () => git(["status", "--porcelain=v2", "--untracked-files=no"]),
  treediff: () => git(["diff", "--raw", "--no-renames", a, b]),
  blobs: () => git(["cat-file", "--batch"], blobInput),
  revparse: () => git(["rev-parse", "HEAD~20"]),
};

function time(fn) {
  fn();
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    fn();
    out.push(performance.now() - t);
  }
  return out;
}

const results = {};
for (const [op, fn] of Object.entries(ours)) {
  const warm = openRepo(path);
  results[`ours ${op}/warm`] = time(() => fn(warm));
  warm.close();
  results[`ours ${op}/cold`] = time(() => {
    const r = openRepo(path);
    fn(r);
    r.close();
  });
}
for (const [op, fn] of Object.entries(cli)) results[`git ${op}`] = time(fn);

const bin = join(here, "rust/target/release/git2-bench");
if (existsSync(bin)) {
  const run = spawnSync(bin, [path, String(n), a, b], { input: blobInput });
  if (run.status !== 0)
    throw new Error(`git2-bench exited ${run.status}: ${run.stderr}`);
  for (const [k, v] of Object.entries(JSON.parse(run.stdout)))
    results[`libgit2 ${k}`] = v;
} else {
  console.log(`libgit2 skipped: ${bin} not built (see bench/README.md)\n`);
}

const stat = (xs) => {
  const s = [...xs].sort((p, q) => p - q);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: at(0.5), p95: at(0.95) };
};
const spawn = stat(results["git spawn"]).median;
const fmt = (x) => x.toFixed(2).padStart(8);
console.log(
  `repo ${path}, ${n} iterations, ${blobs.length} deltified blobs, ${a}..${b}`,
);
console.log(`git spawn (git --version) median ${spawn.toFixed(2)}ms\n`);
console.log(`${"case".padEnd(24)}  median      p95  median-spawn`);
for (const [k, v] of Object.entries(results)) {
  const { median, p95 } = stat(v);
  const net =
    k.startsWith("git ") && k !== "git spawn" ? fmt(median - spawn) : "";
  console.log(`${k.padEnd(24)}${fmt(median)} ${fmt(p95)}  ${net}`);
}
