import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  comparisonRangeParam,
  fetchDiffEntries,
  type ChangesPayload,
  type DiffContent,
  type DiffLine,
} from '@hihyou/github/github-changes';
import type { PrLocation } from '@hihyou/github/pr-location';
import {
  clearLinesSeen,
  fileFullySeen,
  markLinesSeen,
  validateSeen,
  type SeenState,
} from '@hihyou/diff-engine/seen-hunks';
import { analyzeBlob, declHashesBlob } from '@/utils/ast-client';
import { scopeChainAt, type FileAnalysis } from '@hihyou/diff-engine/ast-service';
import { matchMoves, type DeclHash, type MoveBlock } from '@hihyou/diff-engine/moved-code';
import { whitespaceOnlyRows } from '@hihyou/diff-engine/patch';

import { isLineSeen } from '@hihyou/diff-engine/seen-hunks';
import { loadSeenState, prKey, saveSeenState } from '@/utils/seen-store';
import { countableLines, seenCount } from '@hihyou/diff-engine/seen-hunks';
import { setFileViewed } from '@hihyou/github/github-changes';
import { resolveStack, type StackEntry } from '@hihyou/github/pr-stack';
import { CommitStrip } from './CommitStrip';
import { FilePanel } from './FilePanel';
import { installTsHover } from './ts-hover';
import { FileTree, type FileTreeApi } from './FileTree';

export interface ViewerData {
  pr: PrLocation;
  payload: ChangesPayload;
}

export function DiffViewer(props: {
  data: Accessor<ViewerData | null>;
  prev: Accessor<ViewerData | null>;
  native: Accessor<boolean>;
  onToggleNative: () => void;
  onNavigate: (url: string) => void;
}) {
  return (
    <>
      <Portal>
        <button
          class="hihyou-pill"
          classList={{ 'is-native': props.native() }}
          title="Toggle between hihyou and GitHub's native diff view"
          onClick={props.onToggleNative}
        >
          批評 {props.native() ? 'off' : 'on'}
        </button>
      </Portal>
      <Show when={props.data()} keyed>
        {(d) => (
          <PayloadView
            data={d}
            prev={props.prev()}
            onNavigate={props.onNavigate}
          />
        )}
      </Show>
    </>
  );
}

/** One rendered payload; recreated per navigation via the keyed Show. */
function PayloadView(props: {
  data: ViewerData;
  prev: ViewerData | null;
  onNavigate: (url: string) => void;
}) {
  const { pr, payload } = props.data;

  // Commit-nav animation: same PR, different comparison head.
  const prev = props.prev;
  const prevContentByPath =
    prev &&
    prev.pr.owner === pr.owner &&
    prev.pr.repo === pr.repo &&
    prev.pr.number === pr.number &&
    prev.pr.range !== pr.range
      ? new Map(prev.payload.diffContents.map((c) => [c.path, c]))
      : null;
  const animFor = (path: string) => {
    const from = prevContentByPath?.get(path);
    const to = payload.diffContents.find((c) => c.path === path);
    if (!from?.newCommitOid || !to?.newCommitOid) return undefined;
    if (from.newCommitOid === to.newCommitOid) return undefined;
    return { fromOid: from.newCommitOid, toOid: to.newCommitOid };
  };
  const totals = payload.diffSummaries.reduce(
    (acc, s) => ({
      added: acc.added + s.linesAdded,
      deleted: acc.deleted + s.linesDeleted,
    }),
    { added: 0, deleted: 0 },
  );

  // Large PRs inline only a prefix of diff contents; the rest are fetched
  // per-path as their panels approach the viewport.
  const base = new Map(payload.diffContents.map((c) => [c.path, c]));
  const [extra, setExtra] = createSignal<Record<string, DiffContent>>({});
  const contentFor = (path: string) => base.get(path) ?? extra()[path];

  const pending = new Set<string>();
  let queue: string[] = [];
  let timer: number | undefined;
  const flush = async () => {
    const paths = queue;
    queue = [];
    if (!paths.length) return;
    const entries = await fetchDiffEntries(
      pr,
      comparisonRangeParam(payload.comparison),
      paths,
    );
    const got = new Map(entries.map((e) => [e.path, e]));
    const merged: Record<string, DiffContent> = { ...extra() };
    for (const path of paths) {
      merged[path] =
        got.get(path) ?? ({ path, unavailable: true } as DiffContent);
    }
    setExtra(merged);
  };
  const requestContent = (path: string) => {
    if (base.has(path) || pending.has(path)) return;
    pending.add(path);
    queue.push(path);
    clearTimeout(timer);
    if (queue.length >= 20) {
      void flush();
    } else {
      timer = window.setTimeout(() => void flush(), 150);
    }
  };

  // ── Seen state (full-PR view only: line anchors are head-blob numbers) ──
  const seenEnabled = !pr.range;
  const seenKey = prKey(pr);
  const [seen, setSeen] = createSignal<SeenState>({});
  const [seenLoaded, setSeenLoaded] = createSignal(false);
  if (seenEnabled) {
    void loadSeenState(seenKey).then((s) => {
      setSeen(s);
      setSeenLoaded(true);
      setSeenVersion((v) => v + 1);
      // Panels mounted before storage resolved already ran their
      // content-ready hook; reconcile them now.
      for (const c of payload.diffContents) {
        if (c.diffLines?.length) reconcileViewed(c.path, c.diffLines);
      }
    });
  }
  // GitHub's per-file "Viewed" flag, kept in both directions: their flag
  // seeds our seen state; our fully-seen transitions call file_review.
  const [viewed, setViewed] = createSignal<Record<string, boolean>>(
    Object.fromEntries(
      payload.diffSummaries.map((s) => [s.path, s.markedAsViewed]),
    ),
  );
  const [seenVersion, setSeenVersion] = createSignal(0);
  const persist = (next: SeenState) => {
    const prev = seen();
    setSeen(next);
    setSeenVersion((v) => v + 1);
    void saveSeenState(seenKey, next);
    if (!seenEnabled) return;
    for (const path of Object.keys(next)) {
      if (next[path] === prev[path]) continue;
      const lines = contentFor(path)?.diffLines;
      if (!lines?.length) continue;
      const full = fileFullySeen(next[path], lines);
      if (full !== !!viewed()[path]) {
        setViewed({ ...viewed(), [path]: full });
        void setFileViewed(pr, path, full);
      }
    }
  };

  const markLines = (path: string, lines: DiffLine[]) => {
    persist({ ...seen(), [path]: markLinesSeen(seen()[path], lines) });
  };
  const toggleFileSeen = (path: string, checked: boolean) => {
    const lines = contentFor(path)?.diffLines ?? [];
    persist({
      ...seen(),
      [path]: checked
        ? markLinesSeen(seen()[path], lines)
        : clearLinesSeen(seen()[path], lines),
    });
  };
  /**
   * Reconcile with GitHub's Viewed flag: adopt theirs as fully seen, and
   * push ours when the file is fully seen locally but unviewed there.
   * Meaningless before stored seen state resolves.
   */
  const reconcileViewed = (path: string, lines: DiffLine[]) => {
    if (!seenEnabled || !seenLoaded()) return;
    const full = fileFullySeen(seen()[path], lines);
    if (viewed()[path] && !full) {
      persist({
        ...seen(),
        [path]: markLinesSeen(seen()[path], countableLines(lines)),
      });
    } else if (!viewed()[path] && full) {
      setViewed({ ...viewed(), [path]: true });
      void setFileViewed(pr, path, true);
    }
  };

  /** A later commit touching a seen range invalidates it (hash mismatch). */
  const validateFile = (path: string, lines: DiffLine[]) => {
    prefetchAnalysis(path);
    const fileState = seen()[path];
    if (fileState) {
      const { state, changed } = validateSeen(fileState, lines);
      if (changed) persist({ ...seen(), [path]: state });
    }
    // Whitespace-only del/add pairs are always considered applied.
    const wsRows = whitespaceOnlyRows(lines).filter(
      (l) => !isLineSeen(seen()[path], l as DiffLine),
    );
    if (seenEnabled && seenLoaded() && wsRows.length) {
      persist({
        ...seen(),
        [path]: markLinesSeen(seen()[path], wsRows as DiffLine[]),
      });
    }
    reconcileViewed(path, lines);
  };

  // Background AST analysis of the new-side blob (scope snapping for `s`,
  // sticky scopes, import folding). No-op when the SW backend is absent.
  const [analysesMap, setAnalysesMap] = createSignal<
    Record<string, FileAnalysis>
  >({});
  const analyses = {
    get: (path: string): FileAnalysis | undefined => analysesMap()[path],
  };
  const prefetchAnalysis = (path: string) => {
    const oid = contentFor(path)?.newCommitOid;
    if (!oid || analysesMap()[path]) return;
    void analyzeBlob(pr.owner, pr.repo, oid, path).then((a) => {
      if (a) setAnalysesMap({ ...analysesMap(), [path]: a });
    });
  };

  // Sticky scope chain: which declaration chain encloses the diff row at
  // the top of the viewport (just below the sticky file header).
  const [stickyScopes, setStickyScopes] = createSignal<
    Record<string, string>
  >({});
  onMount(() => {
    let timer = 0;
    const update = () => {
      timer = 0;
      const topH =
        viewerEl && getComputedStyle(viewerEl).getPropertyValue('--hihyou-top');
      const probe = document.elementFromPoint(
        window.innerWidth / 2,
        (parseInt(topH || '0', 10) || 0) + 44,
      );
      const row = probe?.closest<HTMLElement>('tr[data-idx]');
      const file = probe?.closest<HTMLElement>('.hihyou-file');
      const path = file?.dataset.path;
      if (!row || !path) {
        if (Object.keys(stickyScopes()).length) setStickyScopes({});
        return;
      }
      const line = contentFor(path)?.diffLines?.[Number(row.dataset.idx)];
      const n = line?.right ?? line?.left;
      const scopes = analyses.get(path)?.scopeRanges;
      if (n === undefined || !scopes) {
        if (Object.keys(stickyScopes()).length) setStickyScopes({});
        return;
      }
      const chain = scopeChainAt(scopes, n)
        .filter((s) => s.start < n && s.name)
        .map((s) => s.name)
        .join(' › ');
      const next = chain ? { [path]: chain } : {};
      if (JSON.stringify(next) !== JSON.stringify(stickyScopes())) {
        setStickyScopes(next);
      }
    };
    // setTimeout, not rAF: rAF freezes in background tabs.
    const onScroll = () => {
      if (!timer) timer = window.setTimeout(update, 80);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onCleanup(() => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(timer);
    });
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (!seenEnabled || e.key !== 'a' || e.metaKey || e.ctrlKey || e.altKey)
      return;
    const active = e.target as HTMLElement | null;
    if (active?.closest?.('input, textarea, [contenteditable]')) return;
    const byPath = new Map<string, DiffLine[]>();
    const byPathIdx = new Map<string, Set<number>>();
    const remember = (path: string, line: DiffLine, idx: number) => {
      (byPath.get(path) ?? byPath.set(path, []).get(path)!).push(line);
      (byPathIdx.get(path) ?? byPathIdx.set(path, new Set()).get(path)!).add(
        idx,
      );
    };
    const sel = window.getSelection();
    if (sel?.rangeCount && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const scopeNode = range.commonAncestorContainer;
      const scope =
        scopeNode instanceof Element ? scopeNode : scopeNode.parentElement;
      const searchRoot = scope?.closest('.hihyou-root') ?? scope;
      if (!searchRoot) return;
      for (const tr of searchRoot.querySelectorAll(
        'tr.hihyou-line[data-idx]',
      )) {
        if (!range.intersectsNode(tr)) continue;
        const path = tr
          .closest<HTMLElement>('.hihyou-file')
          ?.getAttribute('data-path');
        if (!path) continue;
        const idx = Number((tr as HTMLElement).dataset.idx);
        const line = contentFor(path)?.diffLines?.[idx];
        if (!line) continue;
        remember(path, line, idx);
      }
      // Rich (rendered) views have no diff rows: a selection there marks
      // the whole file's changed lines as applied.
      for (const prose of searchRoot.querySelectorAll('.hihyou-prose')) {
        if (!range.intersectsNode(prose)) continue;
        const path = prose
          .closest<HTMLElement>('.hihyou-file')
          ?.getAttribute('data-path');
        const allLines = path && contentFor(path)?.diffLines;
        if (!path || !allLines || byPath.has(path)) continue;
        allLines.forEach((l, idx) => {
          if (l.type === 'ADDITION' || l.type === 'DELETION') {
            remember(path, l, idx);
          }
        });
      }
    }
    if (!byPath.size) return;
    e.preventDefault();
    e.stopPropagation();
    const next = { ...seen() };
    for (const [path, lines] of byPath) {
      // Exactly what was selected/picked — never expanded.
      next[path] = markLinesSeen(next[path], lines);
    }
    persist(next);
    sel?.removeAllRanges();
    // Marking may fold a now-fully-seen file; keep its header in view.
    const folded = [...byPath.keys()].find((p) =>
      fileFullySeen(next[p], contentFor(p)?.diffLines ?? []),
    );
    if (folded) {
      queueMicrotask(() =>
        document
          .querySelector(`.hihyou-file[data-path="${CSS.escape(folded)}"]`)
          ?.scrollIntoView({ block: 'start' }),
      );
    }
  };
  onMount(() => {
    window.addEventListener('keydown', onKeyDown, { capture: true });
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    });
  });

  // ── Moved-code detection: hash top-level declarations of the old and
  // new blobs of changed files, match disappeared -> appeared. ──
  const [moves, setMoves] = createSignal<MoveBlock[]>([]);
  onMount(() => {
    if (payload.diffSummaries.length > 60) return;
    void (async () => {
      const olds: Record<string, DeclHash[]> = {};
      const news: Record<string, DeclHash[]> = {};
      await Promise.all(
        payload.diffContents.map(async (c) => {
          if (!c.diffLines?.length) return;
          const hasDel = c.diffLines.some((l) => l.type === 'DELETION');
          const hasAdd = c.diffLines.some((l) => l.type === 'ADDITION');
          if (hasDel && c.oldTreeEntry) {
            const h = await declHashesBlob(
              pr.owner,
              pr.repo,
              c.oldCommitOid,
              c.oldTreeEntry.path,
            );
            if (h?.length) olds[c.path] = h;
          }
          if (hasAdd && c.newTreeEntry) {
            const h = await declHashesBlob(
              pr.owner,
              pr.repo,
              c.newCommitOid,
              c.path,
            );
            if (h?.length) news[c.path] = h;
          }
        }),
      );
      const found = matchMoves(olds, news);
      if (found.length) setMoves(found);
    })();
  });
  const movedFor = (path: string) =>
    moves().flatMap((m) => [
      ...(m.fromPath === path
        ? [
            {
              side: 'del' as const,
              start: m.fromStart,
              end: m.fromEnd,
              other: m.toPath,
              name: m.name,
            },
          ]
        : []),
      ...(m.toPath === path
        ? [
            {
              side: 'add' as const,
              start: m.toStart,
              end: m.toEnd,
              other: m.fromPath,
              name: m.name,
            },
          ]
        : []),
    ]);

  // Identical moved code inherits seen state: fully-seen source deletions
  // mark the target's additions seen.
  createEffect(() => {
    if (!seenEnabled || !seenLoaded() || !moves().length) return;
    const next = { ...seen() };
    let changed = false;
    for (const m of moves()) {
      const src = contentFor(m.fromPath)?.diffLines;
      const dst = contentFor(m.toPath)?.diffLines;
      if (!src || !dst) continue;
      const srcRows = src.filter(
        (l) =>
          l.type === 'DELETION' && l.left! >= m.fromStart && l.left! <= m.fromEnd,
      );
      if (
        !srcRows.length ||
        !srcRows.every((l) => isLineSeen(next[m.fromPath], l))
      ) {
        continue;
      }
      const dstRows = dst.filter(
        (l) =>
          l.type === 'ADDITION' && l.right! >= m.toStart && l.right! <= m.toEnd,
      );
      if (
        !dstRows.length ||
        dstRows.every((l) => isLineSeen(next[m.toPath], l))
      ) {
        continue;
      }
      next[m.toPath] = markLinesSeen(next[m.toPath], dstRows);
      changed = true;
    }
    if (changed) persist(next);
  });

  // ── TS hover intelligence (M13) ──
  onMount(() => {
    const uninstall = installTsHover({
      pr,
      headOid: payload.comparison.fullDiff.headOid,
      contentFor,
    });
    onCleanup(uninstall);
  });

  const fullySeenFiles = () =>
    payload.diffSummaries.filter((s) =>
      fileFullySeen(seen()[s.path], contentFor(s.path)?.diffLines ?? []),
    ).length;

  // Commit strip: current PR's commits immediately; stacked-PR chain
  // (base branch != default branch) fills in asynchronously.
  const [stack, setStack] = createSignal<StackEntry[]>([
    {
      number: pr.number,
      title: payload.pullRequest?.title ?? '',
      commits: payload.commits,
      isCurrent: true,
    },
  ]);
  void resolveStack(pr, payload).then((entries) => {
    if (entries.length > 1) setStack(entries);
  });

  const summaryByPath = new Map(payload.diffSummaries.map((s) => [s.path, s]));
  const treeApi: FileTreeApi = {
    seenEnabled,
    summaryFor: (path) => summaryByPath.get(path),
    seenLevel: (path) => {
      const lines = contentFor(path)?.diffLines;
      const fileState = seen()[path];
      if (!lines?.length) {
        if (viewed()[path]) return 'full';
        return fileState && (fileState.L.length || fileState.R.length)
          ? 'partial'
          : 'none';
      }
      if (fileFullySeen(fileState, lines)) return 'full';
      return seenCount(fileState, lines) > 0 ? 'partial' : 'none';
    },
    onOpenFile: (path) => {
      const digest = summaryByPath.get(path)?.pathDigest;
      const el = digest && document.getElementById(`hihyou-${digest}`);
      if (el) el.scrollIntoView({ block: 'start' });
      requestContent(path);
    },
    onSetSeen: (paths, checked) => {
      const next = { ...seen() };
      for (const path of paths) {
        const lines = contentFor(path)?.diffLines;
        if (!lines?.length) continue;
        next[path] = checked
          ? markLinesSeen(next[path], lines)
          : clearLinesSeen(next[path], lines);
      }
      persist(next);
    },
  };

  let viewerEl!: HTMLDivElement;
  let topEl!: HTMLDivElement;
  onMount(() => {
    // File headers stick right below the hihyou top bar; its height is
    // dynamic (commit strip wraps/loads async), so track it in a CSS var.
    const sync = () =>
      viewerEl.style.setProperty('--hihyou-top', `${topEl.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(topEl);
    onCleanup(() => ro.disconnect());
  });

  return (
    <div class="hihyou-viewer" ref={viewerEl}>
      <div class="hihyou-top" ref={topEl}>
        <div class="hihyou-bar">
        <strong>批評 hihyou</strong>
        <span>{payload.diffSummaries.length} files</span>
        <span class="hihyou-add">+{totals.added}</span>
        <span class="hihyou-del">−{totals.deleted}</span>
        <span>{payload.commits.length} commits</span>
        <Show when={pr.range}>
          <span class="hihyou-range">{pr.range!.slice(0, 20)}</span>
        </Show>
        <Show when={seenEnabled && seenLoaded()}>
          <span class="hihyou-progress">
            {fullySeenFiles()}/{payload.diffSummaries.length} files applied
          </span>
        </Show>
        </div>
        <CommitStrip stack={stack()} pr={pr} onNavigate={props.onNavigate} />
      </div>
      <div class="hihyou-body">
        <FileTree
          paths={payload.diffSummaries.map((s) => s.path)}
          api={treeApi}
          seenVersion={seenVersion()}
        />
        <div class="hihyou-panels">
          <For each={payload.diffSummaries}>
            {(summary) => (
              <FilePanel
                pr={pr}
                animate={animFor(summary.path)}
                analysis={analysesMap()[summary.path]}
                stickyScope={stickyScopes()[summary.path]}
                moved={movedFor(summary.path)}
                onJumpToFile={treeApi.onOpenFile}
                summary={summary}
                content={contentFor(summary.path)}
                getThread={(id) => payload.markers?.threads?.[id]}
                onNearViewport={() => requestContent(summary.path)}
                seen={seenEnabled ? seen()[summary.path] : undefined}
                seenEnabled={seenEnabled && seenLoaded()}
                onToggleAllSeen={(checked) =>
                  toggleFileSeen(summary.path, checked)
                }
                onContentReady={(lines) => validateFile(summary.path, lines)}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
