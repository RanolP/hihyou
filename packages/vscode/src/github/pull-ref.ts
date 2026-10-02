/** A pull request the user typed; no `owner`/`repo` means any of the workspace's GitHub remotes. */
export interface PullRef {
  owner?: string;
  repo?: string;
  number: number;
}

export const pullRefHint =
  "Pick a pull request, or type its number, URL or owner/repo#123";

const name = String.raw`[\w.-]+`;
const forms = [
  // https://github.com/owner/repo/pull/123, also its /files and /commits/<sha> tabs.
  new RegExp(
    String.raw`^(?:https?://)?(?:www\.)?github\.com/(${name})/(${name})/pull/(\d+)(?:/(?:files|commits(?:/[0-9a-f]{7,40})?))?/?(?:[?#].*)?$`,
    "i",
  ),
  new RegExp(String.raw`^(${name})/(${name})#(\d+)$`),
  /^#?(\d+)$/,
];

/** `undefined` when the input is none of the accepted forms. */
export function parsePullRef(input: string): PullRef | undefined {
  const trimmed = input.trim();
  for (const form of forms) {
    const m = form.exec(trimmed);
    if (!m) continue;
    const groups = m.slice(1);
    const number = Number(groups.at(-1));
    if (!Number.isSafeInteger(number) || number <= 0) return undefined;
    const [owner, repo] = groups;
    return groups.length === 3 && owner && repo
      ? { owner, repo, number }
      : { number };
  }
  return undefined;
}

/** The workspace remotes `ref` can mean: the one it names, matched as GitHub does (ignoring case), or all of them. */
export function remotesFor<R extends { owner: string; repo: string }>(
  ref: PullRef,
  remotes: readonly R[],
): R[] {
  if (!ref.owner || !ref.repo) return [...remotes];
  const key = `${ref.owner}/${ref.repo}`.toLowerCase();
  return remotes.filter((r) => `${r.owner}/${r.repo}`.toLowerCase() === key);
}
