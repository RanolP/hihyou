import { For, Show, createEffect, onCleanup, onMount } from 'solid-js';
import type { DiffContent, DiffLine, DiffSummary } from '@/utils/github-changes';

export function FilePanel(props: {
  summary: DiffSummary;
  content: DiffContent | undefined;
  /** Called when the panel nears the viewport and has no content yet. */
  onNearViewport?: () => void;
}) {
  let section!: HTMLElement;

  onMount(() => {
    if (props.content || !props.onNearViewport) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) props.onNearViewport!();
      },
      { rootMargin: '600px' },
    );
    observer.observe(section);
    createEffect(() => {
      if (props.content) observer.disconnect();
    });
    onCleanup(() => observer.disconnect());
  });

  const note = () => {
    const c = props.content;
    if (!c) return 'Loading diff…';
    if (c.unavailable) return 'Diff unavailable — try the native view';
    if (c.isBinary) return 'Binary file not shown';
    if (c.isSubmodule) return 'Submodule change';
    if (c.isTooBig) return 'Large diff not rendered';
    if (!c.diffLines?.length) return 'No visible changes';
    return null;
  };
  const oldPath = () => props.content?.oldTreeEntry?.path;

  return (
    <section
      ref={section}
      class="hihyou-file"
      id={`hihyou-${props.summary.pathDigest}`}
    >
      <header class="hihyou-file-header">
        <span class="hihyou-file-path">
          <Show when={props.summary.changeType === 'RENAMED' && oldPath()}>
            <span class="hihyou-file-oldpath">{oldPath()} → </span>
          </Show>
          {props.summary.path}
        </span>
        <span class="hihyou-file-stats">
          <Show when={props.summary.linesAdded > 0}>
            <span class="hihyou-add">+{props.summary.linesAdded}</span>
          </Show>
          <Show when={props.summary.linesDeleted > 0}>
            <span class="hihyou-del">−{props.summary.linesDeleted}</span>
          </Show>
          <Show when={props.summary.changeType !== 'MODIFIED'}>
            <span class="hihyou-badge">
              {props.summary.changeType.toLowerCase()}
            </span>
          </Show>
        </span>
      </header>
      <Show
        when={!note()}
        fallback={<div class="hihyou-file-note">{note()}</div>}
      >
        <table class="hihyou-diff">
          <tbody>
            <For each={props.content!.diffLines}>
              {(line) => <DiffRow line={line} />}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// A line never changes shape after render, so branching on type here
// (outside JSX reactivity) is safe.
function DiffRow(props: { line: DiffLine }) {
  const l = props.line;
  if (l.type === 'HUNK') {
    return (
      <tr class="hihyou-line hunk">
        <td class="num" colspan="2" />
        <td class="code">{l.text}</td>
      </tr>
    );
  }
  const cls =
    l.type === 'ADDITION' ? 'add' : l.type === 'DELETION' ? 'del' : 'ctx';
  return (
    <tr class={`hihyou-line ${cls}`}>
      <td class="num">{l.type === 'ADDITION' ? '' : l.left}</td>
      <td class="num">{l.type === 'DELETION' ? '' : l.right}</td>
      {/* GitHub's html is the full line incl. the +/-/space marker. */}
      <td class="code" innerHTML={l.html || escapeHtml(l.text)} />
    </tr>
  );
}
