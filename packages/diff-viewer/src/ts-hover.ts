/**
 * TS hover popovers (M13, content side): hover a symbol in a .ts/.tsx
 * panel → quick info from the background language service, typed against
 * the exact dependency versions in the repo's pnpm-lock at the reviewed
 * commit. Degrades silently without the SW backend.
 */

import type { DiffContent } from '@hihyou/github/github-changes';
import type { PrLocation } from '@hihyou/github/pr-location';
import type { AstClient, ViewerPorts } from './ports';

export interface TsHoverOptions {
  pr: PrLocation;
  headOid: string;
  contentFor: (path: string) => DiffContent | undefined;
  tsHover: AstClient['tsHover'];
  fetchRawBlob: ViewerPorts['fetchRawBlob'];
}

const TS_FILE = /\.(ts|tsx|mts|cts)$/;

export function installTsHover(opts: TsHoverOptions): () => void {
  const cacheKey = `${opts.pr.owner}/${opts.pr.repo}@${opts.headOid}`;
  const blobTexts = new Map<string, Promise<string | null>>();
  let lockfilePromise: Promise<string | null> | null = null;
  let projectSent = false;
  let dead = false;
  let timer = 0;
  let popover: HTMLDivElement | null = null;

  const blobTextFor = (path: string): Promise<string | null> => {
    let p = blobTexts.get(path);
    if (!p) {
      const oid = opts.contentFor(path)?.newCommitOid;
      p = oid
        ? opts.fetchRawBlob(opts.pr.owner, opts.pr.repo, oid, path)
        : Promise.resolve(null);
      blobTexts.set(path, p);
    }
    return p;
  };
  const getLockfile = () => {
    lockfilePromise ??= opts.fetchRawBlob(
      opts.pr.owner,
      opts.pr.repo,
      opts.headOid,
      'pnpm-lock.yaml',
    );
    return lockfilePromise;
  };

  const hide = () => {
    popover?.remove();
    popover = null;
  };
  const show = (x: number, y: number, text: string) => {
    hide();
    popover = document.createElement('div');
    popover.className = 'hihyou-ts-hover';
    popover.textContent = text;
    popover.style.left = `${Math.min(x + 12, window.innerWidth - 420)}px`;
    popover.style.top = `${y + 14}px`;
    document.body.append(popover);
  };

  const onMouseMove = (e: MouseEvent) => {
    clearTimeout(timer);
    if (popover && e.target instanceof Node && !popover.contains(e.target)) {
      hide();
    }
    if (dead) return;
    const { clientX, clientY } = e;
    const target = e.target as HTMLElement;
    timer = window.setTimeout(() => void query(target, clientX, clientY), 450);
  };

  const query = async (target: HTMLElement, x: number, y: number) => {
    const cell = target.closest?.('td.code');
    const tr = target.closest?.<HTMLElement>('tr[data-idx]');
    const path = target.closest?.<HTMLElement>('.hihyou-file')?.dataset.path;
    if (!cell || !tr || !path || !TS_FILE.test(path)) return;
    const line = opts.contentFor(path)?.diffLines?.[Number(tr.dataset.idx)];
    if (!line || line.type === 'DELETION' || line.right === undefined) return;
    const caret = document.caretPositionFromPoint?.(x, y);
    if (!caret || !cell.contains(caret.offsetNode)) return;
    const range = document.createRange();
    range.setStart(cell, 0);
    range.setEnd(caret.offsetNode, caret.offset);
    const col = range.toString().length - 1; // minus the +/-/space marker
    if (col < 0) return;
    const fileText = await blobTextFor(path);
    if (!fileText) return;
    try {
      const request = async (lockfileText?: string | null) =>
        opts.tsHover({
          cacheKey,
          repoFilePath: path,
          fileName: `/${path.split('/').pop()}`,
          fileText,
          line: line.right!,
          col,
          lockfileText,
        });
      let result = await request(
        projectSent ? undefined : ((projectSent = true), await getLockfile()),
      );
      if (result === 'NEED_PROJECT') result = await request(await getLockfile());
      if (result && result !== 'NEED_PROJECT') show(x, y, result);
    } catch {
      dead = true;
    }
  };

  document.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('scroll', hide, { passive: true });
  return () => {
    clearTimeout(timer);
    hide();
    document.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('scroll', hide);
  };
}
