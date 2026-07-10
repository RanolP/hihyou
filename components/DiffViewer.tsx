import {
  For,
  Show,
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
} from '@/utils/github-changes';
import type { PrLocation } from '@/utils/pr-location';
import {
  clearLinesSeen,
  fileFullySeen,
  markLinesSeen,
  validateSeen,
  type SeenState,
} from '@/utils/seen-hunks';
import { loadSeenState, prKey, saveSeenState } from '@/utils/seen-store';
import { seenCount } from '@/utils/seen-hunks';
import { FilePanel } from './FilePanel';
import { FileTree, type FileTreeApi } from './FileTree';

export interface ViewerData {
  pr: PrLocation;
  payload: ChangesPayload;
}

export function DiffViewer(props: {
  data: Accessor<ViewerData | null>;
  native: Accessor<boolean>;
  onToggleNative: () => void;
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
        {(d) => <PayloadView data={d} />}
      </Show>
    </>
  );
}

/** One rendered payload; recreated per navigation via the keyed Show. */
function PayloadView(props: { data: ViewerData }) {
  const { pr, payload } = props.data;
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
    });
  }
  const persist = (next: SeenState) => {
    setSeen(next);
    void saveSeenState(seenKey, next);
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
  /** A later commit touching a seen range invalidates it (hash mismatch). */
  const validateFile = (path: string, lines: DiffLine[]) => {
    const fileState = seen()[path];
    if (!fileState) return;
    const { state, changed } = validateSeen(fileState, lines);
    if (changed) persist({ ...seen(), [path]: state });
  };

  // Drag a selection across diff rows, press `s` → mark seen.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!seenEnabled || e.key !== 's' || e.metaKey || e.ctrlKey || e.altKey)
      return;
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]'))
      return;
    const sel = window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const scopeNode = range.commonAncestorContainer;
    const scope =
      scopeNode instanceof Element ? scopeNode : scopeNode.parentElement;
    if (!scope?.closest('.hihyou-root') && !scope?.querySelector('.hihyou-file'))
      return;
    const byPath = new Map<string, DiffLine[]>();
    for (const tr of (scope.closest('.hihyou-root') ?? scope).querySelectorAll(
      'tr.hihyou-line[data-idx]',
    )) {
      if (!range.intersectsNode(tr)) continue;
      const path = tr
        .closest<HTMLElement>('.hihyou-file')
        ?.getAttribute('data-path');
      if (!path) continue;
      const line =
        contentFor(path)?.diffLines?.[Number((tr as HTMLElement).dataset.idx)];
      if (!line) continue;
      (byPath.get(path) ?? byPath.set(path, []).get(path)!).push(line);
    }
    if (!byPath.size) return;
    e.preventDefault();
    e.stopPropagation();
    const next = { ...seen() };
    for (const [path, lines] of byPath) {
      next[path] = markLinesSeen(next[path], lines);
    }
    persist(next);
    sel.removeAllRanges();
  };
  onMount(() => {
    window.addEventListener('keydown', onKeyDown, { capture: true });
    onCleanup(() =>
      window.removeEventListener('keydown', onKeyDown, { capture: true }),
    );
  });

  const fullySeenFiles = () =>
    payload.diffSummaries.filter((s) =>
      fileFullySeen(seen()[s.path], contentFor(s.path)?.diffLines ?? []),
    ).length;

  const summaryByPath = new Map(payload.diffSummaries.map((s) => [s.path, s]));
  const treeApi: FileTreeApi = {
    seenEnabled,
    summaryFor: (path) => summaryByPath.get(path),
    seenLevel: (path) => {
      const lines = contentFor(path)?.diffLines;
      const fileState = seen()[path];
      if (!lines?.length) {
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

  return (
    <div class="hihyou-viewer">
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
            {fullySeenFiles()}/{payload.diffSummaries.length} files seen
          </span>
        </Show>
      </div>
      <div class="hihyou-body">
        <FileTree
          paths={payload.diffSummaries.map((s) => s.path)}
          api={treeApi}
        />
        <div class="hihyou-panels">
          <For each={payload.diffSummaries}>
            {(summary) => (
              <FilePanel
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
