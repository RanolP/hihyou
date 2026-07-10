import { createEffect, onCleanup, onMount } from 'solid-js';
import '@/utils/custom-elements-shim';
import {
  FileTree as PierreFileTree,
  type GitStatus,
  type GitStatusEntry,
} from '@pierre/trees';
import type { DiffSummary } from '@hihyou/github/github-changes';

export interface FileTreeApi {
  /** 'full' | 'partial' | 'none' seen coverage for one file. */
  seenLevel: (path: string) => 'full' | 'partial' | 'none';
  onOpenFile: (path: string) => void;
  /** Mark/unmark every given file as seen (loaded files only). */
  onSetSeen: (paths: string[], seen: boolean) => void;
  seenEnabled: boolean;
  summaryFor: (path: string) => DiffSummary | undefined;
}

const GIT_STATUS: Record<string, GitStatus> = {
  ADDED: 'added',
  COPIED: 'added',
  DELETED: 'deleted',
  MODIFIED: 'modified',
  CHANGED: 'modified',
  RENAMED: 'renamed',
};

const CHECKBOX = { full: '☑', partial: '◐', none: '☐' } as const;

/** Changed-files sidebar rendered with @pierre/trees (trees.software). */
export function FileTree(props: {
  paths: string[];
  api: FileTreeApi;
  /** Bumped on every seen-state change; repaints row decorations. */
  seenVersion: number;
}) {
  let host!: HTMLDivElement;

  onMount(() => {
    const gitStatus = props.paths.flatMap<GitStatusEntry>((path) => {
      const status = GIT_STATUS[props.api.summaryFor(path)?.changeType ?? ''];
      return status ? [{ path, status }] : [];
    });
    const tree = new PierreFileTree({
      paths: props.paths,
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      search: true,
      stickyFolders: true,
      gitStatus,
      onSelectionChange: (selected) => {
        if (selected[0]) props.api.onOpenFile(selected[0]);
      },
      renderRowDecoration: ({ item }) => {
        if (item.kind !== 'file' || !props.api.seenEnabled) return null;
        const level = props.api.seenLevel(item.path);
        return {
          text: CHECKBOX[level],
          title:
            level === 'full' ? 'Applied — click to unmark' : 'Mark as applied',
        };
      },
      // Seen checkbox goes at the far right edge, AFTER the git-status
      // letter: the git section becomes the right-pushed group and the
      // decoration (normally the flexible middle spacer) tucks in last.
      unsafeCSS: `
        [data-item-section="git"] { order: 1; margin-left: auto; }
        [data-item-section="decoration"] {
          order: 2;
          flex: 0 0 auto;
          margin-left: 6px;
        }
        [data-item-section="decoration"] > * {
          cursor: pointer;
          padding: 0 2px;
          font-size: 13px;
        }
      `,
    });
    tree.render({ containerWrapper: host });

    // Decorations aren't interactive in the library; intercept clicks on
    // them (capture, so row selection doesn't fire) and toggle seen state.
    const onClick = (e: MouseEvent) => {
      if (!props.api.seenEnabled) return;
      const path = e.composedPath();
      const decoration = path.find(
        (n): n is HTMLElement =>
          n instanceof HTMLElement &&
          n.dataset?.itemSection === 'decoration',
      );
      if (!decoration) return;
      const row = path.find(
        (n): n is HTMLElement =>
          n instanceof HTMLElement && !!n.dataset?.itemPath,
      );
      const filePath = row?.dataset.itemPath;
      if (!filePath || row.dataset.itemType !== 'file') return;
      e.preventDefault();
      e.stopPropagation();
      props.api.onSetSeen(
        [filePath],
        props.api.seenLevel(filePath) !== 'full',
      );
      repaint();
    };
    // setComposition unconditionally re-renders the preact root, which
    // re-evaluates every row's decoration (git-status patches early-return
    // when statuses are unchanged).
    const repaint = () => tree.setComposition(tree.getComposition());
    host.addEventListener('click', onClick, { capture: true });

    createEffect<number | undefined>((prev) => {
      const version = props.seenVersion;
      if (prev !== undefined && version !== prev) repaint();
      return version;
    });

    onCleanup(() => {
      host.removeEventListener('click', onClick, { capture: true });
      tree.unmount();
    });
  });

  return <nav class="hihyou-tree" aria-label="Changed files" ref={host} />;
}
