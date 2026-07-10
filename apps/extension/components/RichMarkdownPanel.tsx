import { Show, createResource } from 'solid-js';
import { marked } from 'marked';
import { fetchRawBlob, type DiffContent } from '@/utils/github-changes';
import { diffBlocks, type BlockSeg } from '@/utils/prose-diff';
import type { PrLocation } from '@/utils/pr-location';

function toBlocks(markdown: string): BlockSeg[] {
  if (!markdown) return [];
  const html = marked.parse(markdown, { async: false });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.body.children].map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: el.textContent ?? '',
    html: el.outerHTML,
  }));
}

/**
 * Tracked-changes view for markdown files: renders the document with
 * in-place word-level ins/del marks instead of a line diff.
 */
export function RichMarkdownPanel(props: {
  pr: PrLocation;
  content: DiffContent;
}) {
  const [html] = createResource(async () => {
    const c = props.content;
    const oldPath = c.oldTreeEntry?.path;
    const newPath = c.newTreeEntry?.path ?? c.path;
    const [oldText, newText] = await Promise.all([
      oldPath
        ? fetchRawBlob(props.pr.owner, props.pr.repo, c.oldCommitOid, oldPath)
        : '',
      c.newTreeEntry
        ? fetchRawBlob(props.pr.owner, props.pr.repo, c.newCommitOid, newPath)
        : '',
    ]);
    if (oldText === null || newText === null) throw new Error('blob fetch failed');
    const blocks = diffBlocks(toBlocks(oldText ?? ''), toBlocks(newText ?? ''));
    return blocks.map((b) => `<div class="hihyou-prose-${b.kind}">${b.html}</div>`).join('');
  });

  return (
    <Show
      when={!html.error && html()}
      fallback={
        <div class="hihyou-file-note">
          {html.error ? 'Rich view unavailable' : 'Rendering…'}
        </div>
      }
    >
      <div class="markdown-body hihyou-prose" innerHTML={html()!} />
    </Show>
  );
}
