import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import type {
  DiffContent,
  DiffLine,
  DiffSummary,
  ReviewThread,
} from '@/utils/github-changes';
import type { PrLocation } from '@/utils/pr-location';
import { MagicMovePanel } from './MagicMovePanel';
import {
  countableLines,
  fileFullySeen,
  isLineSeen,
  seenCount,
  type FileSeenState,
} from '@/utils/seen-hunks';
import { ThreadCard } from './ThreadCard';

export function FilePanel(props: {
  pr: PrLocation;
  summary: DiffSummary;
  content: DiffContent | undefined;
  getThread?: (id: string) => ReviewThread | undefined;
  /** Called when the panel nears the viewport and has no content yet. */
  onNearViewport?: () => void;
  seen?: FileSeenState;
  seenEnabled?: boolean;
  onToggleAllSeen?: (checked: boolean) => void;
  /** Fires once when diff lines become available (seen invalidation). */
  onContentReady?: (lines: DiffLine[]) => void;
  /** Commit-nav animation: morph fromOid -> toOid blob before the diff. */
  animate?: { fromOid: string; toOid: string };
}) {
  let section!: HTMLElement;
  const [animating, setAnimating] = createSignal(false);

  onMount(() => {
    if (!props.animate) return;
    const rect = section.getBoundingClientRect();
    const near = rect.top < window.innerHeight + 200 && rect.bottom > -200;
    if (near) setAnimating(true);
  });

  onMount(() => {
    if (props.content || !props.onNearViewport) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) props.onNearViewport!();
      },
      { rootMargin: '600px' },
    );
    observer.observe(section);
    createEffect(() => {
      if (props.content) observer.disconnect();
    });
    onCleanup(() => observer.disconnect());
  });

  let validated = false;
  createEffect(() => {
    const lines = props.content?.diffLines;
    if (lines?.length && !validated) {
      validated = true;
      props.onContentReady?.(lines);
    }
  });

  const note = () => {
    const c = props.content;
    if (!c) return 'Loading diff…';
    if (c.unavailable) return 'Diff unavailable — try the native view';
    if (c.isBinary) return 'Binary file not shown';
    if (c.isSubmodule) return 'Submodule change';
    if (c.isTooBig) return 'Large diff not rendered';
    if (!c.diffLines?.length) return 'No visible changes';
    return null;
  };
  const oldPath = () => props.content?.oldTreeEntry?.path;

  const threadsAt = (l: DiffLine): ReviewThread[] => {
    const mm = props.summary.markersMap;
    const get = props.getThread;
    if (!mm || !get || l.type === 'HUNK') return [];
    const keys =
      l.type === 'DELETION'
        ? [`L${l.left}`]
        : l.type === 'ADDITION'
          ? [`R${l.right}`]
          : [`L${l.left}`, `R${l.right}`];
    return keys
      .flatMap((k) => mm[k]?.threads ?? [])
      .map((t) => get(String(t.id)))
      .filter((t): t is ReviewThread => !!t);
  };

  const lines = () => props.content?.diffLines ?? [];
  const showSeenUi = () => props.seenEnabled && lines().length > 0;

  return (
    <section
      ref={section}
      class="hihyou-file"
      id={`hihyou-${props.summary.pathDigest}`}
      data-path={props.summary.path}
    >
      <header class="hihyou-file-header">
        <span class="hihyou-file-path">
          <Show when={props.summary.changeType === 'RENAMED' && oldPath()}>
            <span class="hihyou-file-oldpath">{oldPath()} → </span>
          </Show>
          {props.summary.path}
        </span>
        <span class="hihyou-file-stats">
          <Show when={props.summary.linesAdded > 0}>
            <span class="hihyou-add">+{props.summary.linesAdded}</span>
          </Show>
          <Show when={props.summary.linesDeleted > 0}>
            <span class="hihyou-del">−{props.summary.linesDeleted}</span>
          </Show>
          <Show when={props.summary.changeType !== 'MODIFIED'}>
            <span class="hihyou-badge">
              {props.summary.changeType.toLowerCase()}
            </span>
          </Show>
          <Show when={showSeenUi()}>
            <span class="hihyou-seen-progress">
              {seenCount(props.seen, lines())}/{countableLines(lines()).length}
            </span>
            <label class="hihyou-seen-toggle" title="Mark whole file as seen">
              <input
                type="checkbox"
                checked={fileFullySeen(props.seen, lines())}
                onChange={(e) =>
                  props.onToggleAllSeen?.(e.currentTarget.checked)
                }
              />
              seen
            </label>
          </Show>
        </span>
      </header>
      <Show
        when={!note()}
        fallback={<div class="hihyou-file-note">{note()}</div>}
      >
        <Show when={animating()}>
          <MagicMovePanel
            owner={props.pr.owner}
            repo={props.pr.repo}
            path={props.summary.path}
            fromOid={props.animate!.fromOid}
            toOid={props.animate!.toOid}
            onDone={() => setAnimating(false)}
          />
        </Show>
        <table class="hihyou-diff" style={{ display: animating() ? 'none' : undefined }}>
          <tbody>
            <For each={props.content!.diffLines}>
              {(line, i) => {
                const threads = threadsAt(line);
                return (
                  <>
                    <DiffRow
                      line={line}
                      idx={i()}
                      seen={() => isLineSeen(props.seen, line)}
                    />
                    <Show when={threads.length > 0}>
                      <tr class="hihyou-thread-row">
                        <td class="num" colspan="2" />
                        <td class="hihyou-thread-cell">
                          <For each={threads}>
                            {(thread) => <ThreadCard thread={thread} />}
                          </For>
                        </td>
                      </tr>
                    </Show>
                  </>
                );
              }}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// A line never changes shape after render, so branching on type here
// (outside JSX reactivity) is safe; only seen-ness is reactive.
function DiffRow(props: { line: DiffLine; idx: number; seen: () => boolean }) {
  const l = props.line;
  if (l.type === 'HUNK') {
    return (
      <tr class="hihyou-line hunk">
        <td class="num" colspan="2" />
        <td class="code">{l.text}</td>
      </tr>
    );
  }
  const cls =
    l.type === 'ADDITION' ? 'add' : l.type === 'DELETION' ? 'del' : 'ctx';
  return (
    <tr
      class={`hihyou-line ${cls}`}
      classList={{ 'hihyou-seen': props.seen() }}
      data-idx={props.idx}
    >
      <td class="num">{l.type === 'ADDITION' ? '' : l.left}</td>
      <td class="num">{l.type === 'DELETION' ? '' : l.right}</td>
      {/* GitHub's html is the full line incl. the +/-/space marker. */}
      <td class="code" innerHTML={l.html || escapeHtml(l.text)} />
    </tr>
  );
}
