import { createEffect, onCleanup, onMount } from 'solid-js';
import type { FileTreeRowDecoration, GitStatus, GitStatusEntry } from '@pierre/trees';
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

/**
 * Changed-files sidebar rendered with @pierre/trees (trees.software).
 * The tree lives in an extension-page iframe: isolated worlds have no
 * customElements, which the library requires. postMessage both ways.
 */
export function FileTree(props: { paths: string[]; api: FileTreeApi }) {
  let iframe!: HTMLIFrameElement;

  const decorations = (): Record<string, FileTreeRowDecoration | null> =>
    Object.fromEntries(
      props.paths.map((path) => {
        if (!props.api.seenEnabled) return [path, null];
        const level = props.api.seenLevel(path);
        return [
          path,
          level === 'full'
            ? { text: '✓', title: 'Seen' }
            : level === 'partial'
              ? { text: '◐', title: 'Partially seen' }
              : null,
        ];
      }),
    );

  const sendInit = () => {
    const gitStatus = props.paths.flatMap<GitStatusEntry>((path) => {
      const status = GIT_STATUS[props.api.summaryFor(path)?.changeType ?? ''];
      return status ? [{ path, status }] : [];
    });
    iframe.contentWindow?.postMessage(
      {
        type: 'hihyou:tree-init',
        paths: props.paths,
        gitStatus,
        decorations: decorations(),
        dark: document.documentElement.getAttribute('data-color-mode') !== 'light',
      },
      '*',
    );
  };

  onMount(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      const msg = e.data as { type?: string; path?: string } | null;
      if (msg?.type === 'hihyou:tree-ready') sendInit();
      else if (msg?.type === 'hihyou:tree-open' && msg.path) {
        props.api.onOpenFile(msg.path);
      }
    };
    window.addEventListener('message', onMessage);
    onCleanup(() => window.removeEventListener('message', onMessage));
  });

  // Seen state changes repaint the tree's decorations.
  createEffect(() => {
    const payload = decorations();
    iframe.contentWindow?.postMessage(
      { type: 'hihyou:tree-seen', decorations: payload },
      '*',
    );
  });

  return (
    <iframe
      class="hihyou-tree"
      title="Changed files"
      ref={iframe}
      src={browser.runtime.getURL('/tree.html')}
    />
  );
}
