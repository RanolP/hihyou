/**
 * Takeover of GitHub's diff viewer region.
 *
 * GitHub's React app owns `#diff-comparison-viewer-container`. Inside it,
 * `.prc-PageLayout-Header` holds the PR title/tabs (kept native) and
 * `.prc-PageLayout-PageLayoutContent` holds the toolbar, file tree, and diff
 * panels (what we replace). We never touch React's own children; our root is
 * appended as a foreign sibling — React leaves unknown siblings alone — and
 * visibility flips via a `data-hihyou` attribute + CSS.
 */

const CONTAINER_ID = 'diff-comparison-viewer-container';
export const ROOT_CLASS = 'hihyou-root';
const CONTENT_SELECTOR = '[class*="prc-PageLayout-PageLayoutContent"]';

export interface TakeoverMount {
  /** Carries the `data-hihyou` visibility attribute. */
  container: HTMLElement;
  /** Parent for our root, beside GitHub's content pane. */
  host: HTMLElement;
}

export function findMount(): TakeoverMount | null {
  const container = document.getElementById(CONTAINER_ID);
  const content = container?.querySelector(CONTENT_SELECTOR);
  if (!container || !content?.parentElement) return null;
  return { container, host: content.parentElement as HTMLElement };
}

/** Both elements render asynchronously after a soft navigation; wait. */
export function waitForMount(timeoutMs = 15_000): Promise<TakeoverMount | null> {
  const existing = findMount();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
    const observer = new MutationObserver(() => {
      const mount = findMount();
      if (mount) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(mount);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/** `native = true` shows GitHub's viewer, `false` shows hihyou's. */
export function setNativeView(native: boolean): void {
  const el = document.getElementById(CONTAINER_ID);
  const want = native ? 'off' : 'on';
  if (el && el.getAttribute('data-hihyou') !== want) {
    el.setAttribute('data-hihyou', want);
  }
}

export function releaseTakeover(): void {
  document.getElementById(CONTAINER_ID)?.removeAttribute('data-hihyou');
}
