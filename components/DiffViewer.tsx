import { For, Show, createSignal, type Accessor } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  comparisonRangeParam,
  fetchDiffEntries,
  type ChangesPayload,
  type DiffContent,
} from '@/utils/github-changes';
import type { PrLocation } from '@/utils/pr-location';
import { FilePanel } from './FilePanel';

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
      </div>
      <For each={payload.diffSummaries}>
        {(summary) => (
          <FilePanel
            summary={summary}
            content={contentFor(summary.path)}
            getThread={(id) => payload.markers?.threads?.[id]}
            onNearViewport={() => requestContent(summary.path)}
          />
        )}
      </For>
    </div>
  );
}
