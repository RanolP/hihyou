/**
 * What hihyou posts to GitHub is lowered to plain review content, so an author without hihyou reads an ordinary
 * review: the verdict as a sentence, provenance in `<details>`, and the machine-readable key in an HTML comment,
 * which GitHub hides when rendering and hihyou reads back to restore the node anchor. The key is untrusted input:
 * anyone can write it, so it only ever restores an anchor, and a key that fails validation is ignored.
 */
import type { AnchorData } from "@hihyou/engine";
import type { Score } from "@hihyou/ui";

/** The node a comment was written on, the git blob SHAs of its file's two sides then, and the node's score. */
export interface LoweredKey {
  anchor: AnchorData;
  before: string | null;
  after: string | null;
  score?: Score;
}

const scoreWords: Record<Score, string> = {
  2: "good to merge",
  1: "looks good",
  [-1]: "would rather not",
  [-2]: "must not merge",
};

/** "-1: would rather not", as the score keys name each score. */
export const verdictSentence = (score: Score): string =>
  `${score > 0 ? "+" : ""}${score}: ${scoreWords[score]}`;

/** The body as a reader sees it: the verdict sentence, when the node is scored, ahead of the comment. */
export const withVerdict = (body: string, score: Score | undefined): string =>
  score === undefined ? body : `${verdictSentence(score)}\n\n${body}`;

const summary = "<details>\n<summary>hihyou</summary>\n\n";
const keyComment = /(?:^|\n\n)<!-- hihyou (\{.*\}) -->\s*$/;

const short = (sha: string | null) => (sha === null ? "none" : sha.slice(0, 7));

/** `withVerdict`'s body, then the provenance and the key; `JSON` carries no `>` outside strings, so none closes the comment. */
export function lowerComment(body: string, key: LoweredKey): string {
  const { anchor } = key;
  const nodes = anchor.nodes.map((s) => `[${s.join(", ")}]`).join(", ");
  const chars = anchor.chars
    ? `, characters ${anchor.chars.start}-${anchor.chars.end}`
    : "";
  const provenance = `Written in hihyou on node ${nodes}${chars} of \`${anchor.path}\` (${anchor.side} side), blobs ${short(key.before)} → ${short(key.after)}.`;
  const json = JSON.stringify({
    anchor: {
      side: anchor.side,
      path: anchor.path,
      nodes: anchor.nodes,
      ...(anchor.chars && { chars: anchor.chars }),
    },
    before: key.before,
    after: key.after,
    ...(key.score !== undefined && { score: key.score }),
  }).replace(/>/g, "\\u003e");
  return `${withVerdict(body, key.score)}\n\n${summary}${provenance}\n\n</details>\n\n<!-- hihyou ${json} -->`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isIndex = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isSha = (v: unknown): v is string | null =>
  v === null ||
  (typeof v === "string" && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(v));

/** The key, rebuilt from only the fields it may carry, or undefined when any of them is malformed. */
export function validKey(raw: unknown): LoweredKey | undefined {
  if (!isRecord(raw) || !isRecord(raw["anchor"])) return undefined;
  const { side, path, nodes, chars } = raw["anchor"];
  const { before, after, score } = raw;
  if (side !== "before" && side !== "after") return undefined;
  if (typeof path !== "string" || path === "") return undefined;
  if (
    !Array.isArray(nodes) ||
    nodes.length === 0 ||
    !nodes.every((s) => Array.isArray(s) && s.every(isIndex))
  )
    return undefined;
  if (
    chars !== undefined &&
    !(
      isRecord(chars) &&
      nodes.length === 1 &&
      isIndex(chars["start"]) &&
      isIndex(chars["end"]) &&
      chars["start"] <= chars["end"]
    )
  )
    return undefined;
  if (!isSha(before) || !isSha(after) || (before === null && after === null))
    return undefined;
  if (
    score !== undefined &&
    score !== -2 &&
    score !== -1 &&
    score !== 1 &&
    score !== 2
  )
    return undefined;
  const anchor: AnchorData = {
    side,
    path,
    nodes: (nodes as number[][]).map((s) => [...s]),
    ...(chars !== undefined && {
      chars: { start: chars["start"] as number, end: chars["end"] as number },
    }),
  };
  return { anchor, before, after, ...(score !== undefined && { score }) };
}

/**
 * A posted body read back: with a valid key, the body `withVerdict` made, the provenance and key dropped; without
 * one (none, or one failing validation), the body exactly as posted, as plain as GitHub shows it.
 */
export function readLowered(posted: string): {
  body: string;
  key?: LoweredKey;
} {
  const m = keyComment.exec(posted);
  if (!m) return { body: posted };
  let key: LoweredKey | undefined;
  try {
    key = validKey(JSON.parse(m[1] as string));
  } catch {
    // not JSON: shown as written
  }
  if (!key) return { body: posted };
  let body = posted.slice(0, m.index);
  const details = body.lastIndexOf(`\n\n${summary}`);
  if (details >= 0 && body.endsWith("\n\n</details>"))
    body = body.slice(0, details);
  return { body, key };
}
