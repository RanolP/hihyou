import { For, Show } from 'solid-js';
import type { ReviewThread } from '@hihyou/github/github-changes';

export function ThreadCard(props: { thread: ReviewThread }) {
  const comments = () =>
    props.thread.commentsData.comments.filter((c) => !c.isHidden);

  const body = (
    <div class="hihyou-thread" classList={{ resolved: props.thread.isResolved }}>
      <For each={comments()}>
        {(c) => (
          <div class="hihyou-comment">
            <div class="hihyou-comment-head">
              <img class="hihyou-avatar" src={c.author.avatarUrl} alt="" />
              <strong>{c.author.login}</strong>
              <span class="hihyou-comment-time">
                {new Date(c.createdAt).toLocaleDateString()}
              </span>
              <Show when={c.state === 'PENDING'}>
                <span class="hihyou-badge hihyou-pending">pending</span>
              </Show>
            </div>
            <div class="markdown-body hihyou-comment-body" innerHTML={c.bodyHTML} />
          </div>
        )}
      </For>
    </div>
  );

  return (
    <Show when={props.thread.isResolved} fallback={body}>
      <details class="hihyou-thread-collapsed">
        <summary>
          Resolved
          {props.thread.resolvedBy ? ` by ${props.thread.resolvedBy}` : ''} ·{' '}
          {comments().length}{' '}
          {comments().length === 1 ? 'comment' : 'comments'}
        </summary>
        {body}
      </details>
    </Show>
  );
}
