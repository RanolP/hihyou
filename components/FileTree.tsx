import { onCleanup, onMount } from 'solid-js';
import '@/utils/custom-elements-shim';
import {
  FileTree as PierreFileTree,
  type GitStatus,
  type GitStatusEntry,
} from '@pierre/trees';
import type { DiffSummary } from '@/utils/github-changes';

export interface FileTreeApi {
  /** 'full' | 'partial' | 'none' seen coverage for one file. */
  seenLevel: (path: string) => 'full' | 'partial' | 'none';
  onOpenFile: (path: string) => void;
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

/** Changed-files sidebar rendered with @pierre/trees (trees.software). */
export function FileTree(props: { paths: string[]; api: FileTreeApi }) {
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
        if (level === 'full') return { text: '✓', title: 'Seen' };
        if (level === 'partial') return { text: '◐', title: 'Partially seen' };
        return null;
      },
    });
    tree.render({ containerWrapper: host });
    onCleanup(() => tree.unmount());
  });

  return <nav class="hihyou-tree" aria-label="Changed files" ref={host} />;
}
