/**
 * File-tree page, embedded by the content script as an iframe.
 * @pierre/trees needs real custom-element support, which content-script
 * isolated worlds lack (customElements is null there); extension pages
 * have it. Data flows in and clicks flow out via postMessage.
 */

import {
  FileTree,
  type FileTreeRowDecoration,
  type GitStatusEntry,
} from '@pierre/trees';

interface InitMessage {
  type: 'hihyou:tree-init';
  paths: string[];
  gitStatus: GitStatusEntry[];
  decorations: Record<string, FileTreeRowDecoration | null>;
  dark: boolean;
}

interface SeenMessage {
  type: 'hihyou:tree-seen';
  decorations: Record<string, FileTreeRowDecoration | null>;
}

let tree: FileTree | null = null;
let decorations: Record<string, FileTreeRowDecoration | null> = {};

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as InitMessage | SeenMessage | null;
  if (msg?.type === 'hihyou:tree-init') {
    document.documentElement.style.colorScheme = msg.dark ? 'dark' : 'light';
    decorations = msg.decorations;
    tree?.unmount();
    const root = document.getElementById('root')!;
    root.innerHTML = '';
    tree = new FileTree({
      paths: msg.paths,
      gitStatus: msg.gitStatus,
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      search: true,
      stickyFolders: true,
      onSelectionChange: (selected) => {
        if (selected[0]) {
          window.parent.postMessage(
            { type: 'hihyou:tree-open', path: selected[0] },
            '*',
          );
        }
      },
      renderRowDecoration: ({ item }) =>
        item.kind === 'file' ? (decorations[item.path] ?? null) : null,
    });
    tree.render({ containerWrapper: root });
  } else if (msg?.type === 'hihyou:tree-seen') {
    decorations = msg.decorations;
  }
});

window.parent.postMessage({ type: 'hihyou:tree-ready' }, '*');
