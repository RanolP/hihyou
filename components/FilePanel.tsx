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
import { RichMarkdownPanel } from './RichMarkdownPanel';
import type { FileAnalysis } from '@/utils/ast-service';
import { importFold } from '@/utils/import-fold';
import { scoreInjectionLang } from '@/utils/injection-heuristic';
import { currentShikiTheme, getHighlighter } from '@/utils/highlight';

export interface MovedRange {
  side: 'add' | 'del';
  start: number;
  end: number;
  other: string;
  name: string;
}

function moveMatches(r: MovedRange, line: DiffLine): boolean {
  return r.side === 'del'
    ? line.type === 'DELETION' &&
        line.left! >= r.start &&
        line.left! <= r.end
    : line.type === 'ADDITION' &&
        line.right! >= r.start &&
        line.right! <= r.end;
}
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
  analysis?: FileAnalysis;
  /** Enclosing declaration chain for the row pinned at viewport top. */
  stickyScope?: string;
  /** Moved-code ranges in this file (blob line numbers per side). */
  moved?: MovedRange[];
  onJumpToFile?: (path: string) => void;
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

  // Fully-reviewed files fold away; the chevron/path reopens them.
  const fullySeen = () =>
    !!props.seenEnabled && fileFullySeen(props.seen, lines());
  const [manualOpen, setManualOpen] = createSignal<boolean | null>(null);
  const collapsed = () =>
    manualOpen() !== null
      ? !manualOpen()
      : fullySeen() ||
        // Content not loaded yet but GitHub has it marked Viewed.
        (!!props.seenEnabled &&
          !lines().length &&
          props.summary.markedAsViewed);

  // Folding while scrolled inside the file would leave the viewport on
  // unrelated content; align the folded header to the sticky top.
  // (scrollIntoView + scroll-margin-top: the document shrinks on fold, so
  // manual scroll math gets clamped.)
  const scrolledInside = () => {
    const top =
      parseInt(
        getComputedStyle(section).getPropertyValue('--hihyou-top'),
        10,
      ) || 0;
    return section.getBoundingClientRect().top < top;
  };
  const alignToTop = () =>
    queueMicrotask(() => section.scrollIntoView({ block: 'start' }));
  const toggleCollapsed = () => {
    const folding = !collapsed();
    const inside = scrolledInside();
    setManualOpen(collapsed());
    if (folding && inside) alignToTop();
  };

  const isMarkdown = /\.(md|markdown)$/i.test(props.summary.path);
  // Markdown defaults to the rendered tracked-changes view.
  const [rich, setRich] = createSignal(isMarkdown);

  // Literal language injection: re-highlight lines inside css/html
  // template literals with shiki (nested language, not the host's).
  const [injHtml, setInjHtml] = createSignal<Record<number, string>>({});
  createEffect(() => {
    const ranges = props.analysis?.injectionRanges;
    const ls = props.content?.diffLines;
    if (!ranges?.length || !ls?.length) return;
    void (async () => {
      const highlighter = await getHighlighter();
      const theme = currentShikiTheme();
      const map: Record<number, string> = {};
      for (const r of ranges) {
        // Interior lines only — the backtick lines stay host-highlighted.
        const rows = ls
          .map((l, i) => ({ l, i }))
          .filter(
            ({ l }) =>
              l.type !== 'HUNK' &&
              l.right !== undefined &&
              l.right > r.start &&
              l.right < r.end,
          );
        if (!rows.length) continue;
        const lang =
          r.lang === 'auto'
            ? scoreInjectionLang(rows.map(({ l }) => l.text.slice(1)))
            : r.lang;
        if (!lang || !['css', 'html'].includes(lang)) continue;
        for (const { l, i } of rows) {
          try {
            const full = highlighter.codeToHtml(l.text.slice(1), {
              lang,
              theme,
            });
            const inner = full
              .replace(/^[\s\S]*?<code[^>]*>/, '')
              .replace(/<\/code>[\s\S]*$/, '');
            map[i] = escapeHtml(l.text[0] ?? ' ') + inner;
          } catch {
            /* keep host highlighting */
          }
        }
      }
      if (Object.keys(map).length) setInjHtml(map);
    })();
  });

  // Import block folds by default; changed lines inside keep it folded
  // but are called out in the notice.
  const fold = () =>
    props.analysis ? importFold(lines(), props.analysis.importRanges) : null;
  const [importsOpen, setImportsOpen] = createSignal(false);
  const hiddenByFold = (idx: number) => {
    const f = fold();
    return !!f && !importsOpen() && idx >= f.startIdx && idx <= f.endIdx;
  };

  return (
    <section
      ref={section}
      class="hihyou-file"
      id={`hihyou-${props.summary.pathDigest}`}
      data-path={props.summary.path}
    >
      <header class="hihyou-file-header">
        <button
          class="hihyou-file-chevron"
          title={collapsed() ? 'Expand file' : 'Collapse file'}
          onClick={toggleCollapsed}
        >
          {collapsed() ? '▸' : '▾'}
        </button>
        <span class="hihyou-file-path" onClick={toggleCollapsed}>
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
          <Show when={isMarkdown && !note()}>
            <button
              class="hihyou-badge hihyou-view-toggle"
              title="Toggle rendered / source diff"
              onClick={() => setRich((v) => !v)}
            >
              {rich() ? 'source' : 'rich'}
            </button>
          </Show>
          <Show when={showSeenUi()}>
            <span class="hihyou-seen-progress">
              {seenCount(props.seen, lines())}/{countableLines(lines()).length}
            </span>
            <label class="hihyou-seen-toggle" title="Mark whole file as seen">
              <input
                type="checkbox"
                checked={fileFullySeen(props.seen, lines())}
                onChange={(e) => {
                  const inside = scrolledInside();
                  props.onToggleAllSeen?.(e.currentTarget.checked);
                  if (e.currentTarget.checked && inside) alignToTop();
                }}
              />
              seen
            </label>
          </Show>
        </span>
      </header>
      <Show when={props.stickyScope && !collapsed()}>
        <div class="hihyou-scope-bar">{props.stickyScope}</div>
      </Show>
      <Show
        when={!note() && !collapsed()}
        fallback={
          <Show when={!collapsed()}>
            <div class="hihyou-file-note">{note()}</div>
          </Show>
        }
      >
        <Show when={rich()}>
          <RichMarkdownPanel pr={props.pr} content={props.content!} />
        </Show>
        <Show when={animating() && !rich()}>
          <MagicMovePanel
            owner={props.pr.owner}
            repo={props.pr.repo}
            path={props.summary.path}
            fromOid={props.animate!.fromOid}
            toOid={props.animate!.toOid}
            onDone={() => setAnimating(false)}
          />
        </Show>
        <table
          class="hihyou-diff"
          style={{ display: animating() || rich() ? 'none' : undefined }}
        >
          <tbody>
            <For each={props.content!.diffLines}>
              {(line, i) => {
                const threads = threadsAt(line);
                return (
                  <>
                    <Show when={fold() && i() === fold()!.startIdx}>
                      <tr class="hihyou-line hihyou-fold-row">
                        <td class="num" colspan="2" />
                        <td
                          class="code hihyou-fold-notice"
                          onClick={() => setImportsOpen((v) => !v)}
                        >
                          {importsOpen() ? '▾' : '▸'} {fold()!.total} import
                          lines {importsOpen() ? '' : 'hidden'}
                          {fold()!.changed > 0
                            ? ` (${fold()!.changed} changed)`
                            : ''}
                        </td>
                      </tr>
                    </Show>
                    <Show
                      when={props.moved?.find(
                        (r) =>
                          moveMatches(r, line) &&
                          (r.side === 'del'
                            ? line.left === r.start
                            : line.right === r.start),
                      )}
                    >
                      {(range) => (
                        <tr class="hihyou-line hihyou-move-row">
                          <td class="num" colspan="2" />
                          <td
                            class="code hihyou-move-notice"
                            onClick={() => props.onJumpToFile?.(range().other)}
                          >
                            ⇄ {range().name || 'code'} moved{' '}
                            {range().side === 'del' ? 'to' : 'from'}{' '}
                            {range().other}
                          </td>
                        </tr>
                      )}
                    </Show>
                    <Show when={!hiddenByFold(i())}>
                      <DiffRow
                        line={line}
                        idx={i()}
                        seen={() => isLineSeen(props.seen, line)}
                        moved={
                          !!props.moved?.some((r) => moveMatches(r, line))
                        }
                        overrideHtml={() => injHtml()[i()]}
                      />
                    </Show>
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
function DiffRow(props: {
  line: DiffLine;
  idx: number;
  seen: () => boolean;
  moved?: boolean;
  /** Nested-language re-highlight (literal injection). */
  overrideHtml?: () => string | undefined;
}) {
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
      classList={{ 'hihyou-seen': props.seen(), 'hihyou-moved': props.moved }}
      data-idx={props.idx}
    >
      <td class="num">{l.type === 'ADDITION' ? '' : l.left}</td>
      <td class="num">{l.type === 'DELETION' ? '' : l.right}</td>
      {/* GitHub's html is the full line incl. the +/-/space marker. */}
      <td
        class="code"
        innerHTML={props.overrideHtml?.() ?? (l.html || escapeHtml(l.text))}
      />
    </tr>
  );
}
