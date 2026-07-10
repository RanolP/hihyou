import { For, Show } from 'solid-js';
import type { PrLocation } from '@hihyou/github/pr-location';
import type { StackEntry } from '@hihyou/github/pr-stack';

interface FlatCommit {
  entry: StackEntry;
  oid: string;
  shortOid: string;
  title: string;
  url: string;
}

export function CommitStrip(props: {
  stack: StackEntry[];
  pr: PrLocation;
  /** Soft in-place navigation; plain href navigation as fallback. */
  onNavigate?: (url: string) => void;
}) {
  const commitUrl = (entry: StackEntry, oid: string) =>
    `/${props.pr.owner}/${props.pr.repo}/pull/${entry.number}/changes/${oid}`;
  const flat = (): FlatCommit[] =>
    props.stack.flatMap((entry) =>
      entry.commits.map((c) => ({
        entry,
        oid: c.oid,
        shortOid: c.shortOid,
        title: `${c.messageHeadline} — ${c.actorLogin}`,
        url: commitUrl(entry, c.oid),
      })),
    );
  const activeIndex = () => {
    const range = props.pr.range;
    if (!range) return -1;
    return flat().findIndex(
      (c) => c.oid === range || range.endsWith(`..${c.oid}`),
    );
  };
  const allUrl = () =>
    `/${props.pr.owner}/${props.pr.repo}/pull/${props.pr.number}/changes`;
  const isActive = (oid: string) =>
    oid === props.pr.range || !!props.pr.range?.endsWith(`..${oid}`);
  const go = (e: MouseEvent, url: string | undefined) => {
    if (!url || !props.onNavigate || e.metaKey || e.ctrlKey || e.shiftKey)
      return;
    e.preventDefault();
    props.onNavigate(url);
  };

  return (
    <div class="hihyou-commits">
      <a
        class="hihyou-commit-chip all"
        classList={{ active: activeIndex() === -1 }}
        href={allUrl()}
        onClick={(e) => go(e, allUrl())}
      >
        All
      </a>
      <a
        class="hihyou-commit-chip nav"
        classList={{ disabled: activeIndex() <= 0 }}
        href={activeIndex() > 0 ? flat()[activeIndex() - 1].url : undefined}
        onClick={(e) =>
          go(e, activeIndex() > 0 ? flat()[activeIndex() - 1].url : undefined)
        }
        title="Previous commit"
      >
        ‹
      </a>
      <a
        class="hihyou-commit-chip nav"
        classList={{ disabled: activeIndex() >= flat().length - 1 }}
        href={
          activeIndex() < flat().length - 1
            ? flat()[activeIndex() + 1].url
            : undefined
        }
        onClick={(e) =>
          go(
            e,
            activeIndex() < flat().length - 1
              ? flat()[activeIndex() + 1].url
              : undefined,
          )
        }
        title="Next commit"
      >
        ›
      </a>
      <div class="hihyou-commit-scroll">
        <For each={props.stack}>
          {(entry) => (
            <>
              <Show when={props.stack.length > 1}>
                <span
                  class="hihyou-commit-boundary"
                  classList={{ current: entry.isCurrent }}
                  title={entry.title}
                >
                  #{entry.number}
                </span>
              </Show>
              <For each={entry.commits}>
                {(c) => (
                  <a
                    class="hihyou-commit-chip"
                    classList={{
                      active: isActive(c.oid),
                      foreign: !entry.isCurrent,
                    }}
                    href={commitUrl(entry, c.oid)}
                    onClick={(e) =>
                      entry.isCurrent
                        ? go(e, commitUrl(entry, c.oid))
                        : undefined
                    }
                    title={`${c.messageHeadline} — ${c.actorLogin}`}
                  >
                    {c.shortOid.slice(0, 7)}
                  </a>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}
