import { For, Show, createEffect, createSignal } from 'solid-js';
import { buildFileTree, treeFilePaths, type TreeDir } from '@/utils/file-tree';
import type { DiffSummary } from '@/utils/github-changes';

export interface FileTreeApi {
  /** 'full' | 'partial' | 'none' seen coverage for one file. */
  seenLevel: (path: string) => 'full' | 'partial' | 'none';
  onOpenFile: (path: string) => void;
  /** Mark/unmark every given file as seen (loaded files only). */
  onSetSeen: (paths: string[], seen: boolean) => void;
  seenEnabled: boolean;
  summaryFor: (path: string) => DiffSummary | undefined;
}

export function FileTree(props: { paths: string[]; api: FileTreeApi }) {
  const root = () => buildFileTree(props.paths);
  return (
    <nav class="hihyou-tree" aria-label="Changed files">
      <DirBody dir={root()} api={props.api} />
    </nav>
  );
}

function DirBody(props: { dir: TreeDir; api: FileTreeApi }) {
  return (
    <>
      <For each={props.dir.dirs}>
        {(dir) => <DirRow dir={dir} api={props.api} />}
      </For>
      <For each={props.dir.files}>
        {(file) => <FileRow path={file.path} name={file.name} api={props.api} />}
      </For>
    </>
  );
}

function DirRow(props: { dir: TreeDir; api: FileTreeApi }) {
  const [open, setOpen] = createSignal(true);
  const level = () => {
    const paths = treeFilePaths(props.dir);
    const levels = paths.map((p) => props.api.seenLevel(p));
    if (levels.every((l) => l === 'full')) return 'full';
    if (levels.some((l) => l !== 'none')) return 'partial';
    return 'none';
  };
  let checkbox!: HTMLInputElement;
  createEffect(() => {
    if (props.api.seenEnabled) checkbox.indeterminate = level() === 'partial';
  });

  return (
    <div class="hihyou-tree-dir">
      <div class="hihyou-tree-row">
        <button
          class="hihyou-tree-label"
          onClick={() => setOpen((v) => !v)}
          title={props.dir.path}
        >
          <span class="hihyou-tree-chevron">{open() ? '▾' : '▸'}</span>
          <span class="hihyou-tree-icon dir">{open() ? '▤' : '▣'}</span>
          <span class="hihyou-tree-name">{props.dir.name}</span>
        </button>
        <Show when={props.api.seenEnabled}>
          <input
            ref={checkbox}
            type="checkbox"
            class="hihyou-tree-check"
            title="Mark folder as seen"
            checked={level() === 'full'}
            onChange={(e) =>
              props.api.onSetSeen(
                treeFilePaths(props.dir),
                e.currentTarget.checked,
              )
            }
          />
        </Show>
      </div>
      <Show when={open()}>
        <div class="hihyou-tree-children">
          <DirBody dir={props.dir} api={props.api} />
        </div>
      </Show>
    </div>
  );
}

const ICONS: Record<string, { label: string; color: string }> = {
  ts: { label: 'TS', color: '#3178c6' },
  tsx: { label: 'TX', color: '#3178c6' },
  js: { label: 'JS', color: '#e8d44d' },
  jsx: { label: 'JX', color: '#e8d44d' },
  mjs: { label: 'JS', color: '#e8d44d' },
  cjs: { label: 'JS', color: '#e8d44d' },
  json: { label: '{}', color: '#cbcb41' },
  jsonc: { label: '{}', color: '#cbcb41' },
  md: { label: 'M↓', color: '#519aba' },
  css: { label: '#', color: '#663399' },
  scss: { label: '#', color: '#f55385' },
  html: { label: '<>', color: '#e34c26' },
  vue: { label: 'V', color: '#41b883' },
  svelte: { label: 'S', color: '#ff3e00' },
  svg: { label: '◨', color: '#ffb13b' },
  png: { label: '◨', color: '#a074c4' },
  yml: { label: 'Y', color: '#cb171e' },
  yaml: { label: 'Y', color: '#cb171e' },
  rs: { label: 'R', color: '#dea584' },
  py: { label: 'PY', color: '#3572a5' },
  lock: { label: '🔒', color: '#8a939f' },
};

function iconFor(name: string): { label: string; color: string } {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return ICONS[ext] ?? { label: '≡', color: 'var(--fgColor-muted, #656d76)' };
}

function FileRow(props: { path: string; name: string; api: FileTreeApi }) {
  const icon = () => iconFor(props.name);
  const level = () => props.api.seenLevel(props.path);
  const summary = () => props.api.summaryFor(props.path);
  return (
    <div
      class="hihyou-tree-row file"
      classList={{ 'is-seen': level() === 'full' }}
    >
      <button
        class="hihyou-tree-label"
        title={props.path}
        onClick={() => props.api.onOpenFile(props.path)}
      >
        <span class="hihyou-tree-icon" style={{ color: icon().color }}>
          {icon().label}
        </span>
        <span class="hihyou-tree-name">{props.name}</span>
        <Show when={summary()}>
          <span class="hihyou-tree-stats">
            <Show when={summary()!.linesAdded > 0}>
              <span class="hihyou-add">+{summary()!.linesAdded}</span>
            </Show>
            <Show when={summary()!.linesDeleted > 0}>
              <span class="hihyou-del">−{summary()!.linesDeleted}</span>
            </Show>
          </span>
        </Show>
      </button>
      <Show when={props.api.seenEnabled}>
        <input
          type="checkbox"
          class="hihyou-tree-check"
          title="Mark file as seen"
          checked={level() === 'full'}
          ref={(el) => {
            createEffect(() => {
              el.indeterminate = level() === 'partial';
            });
          }}
          onChange={(e) =>
            props.api.onSetSeen([props.path], e.currentTarget.checked)
          }
        />
      </Show>
    </div>
  );
}
