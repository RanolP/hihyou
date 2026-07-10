import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { DiffViewer, type ViewerData } from '@/components/DiffViewer';
import '@/components/diff-viewer.css';
import {
  ROOT_CLASS,
  releaseTakeover,
  setNativeView,
  waitForMount,
} from '@/utils/takeover';

export default defineContentScript({
  matches: ['https://github.com/*'],
  main(ctx) {
    // Only the initial hard load can trust the embedded payload; GitHub's
    // React app soft-navigates between commits and leaves it stale.
    let initialLoad = true;
    let navToken = 0;

    const [data, setData] = createSignal<ViewerData | null>(null);
    const [native, setNative] = createSignal(false);
    let rootEl: HTMLElement | null = null;
    let dispose: (() => void) | null = null;

    const teardown = () => {
      dispose?.();
      dispose = null;
      rootEl?.remove();
      rootEl = null;
      setData(null);
      releaseTakeover();
    };

    const toggleNative = () => {
      const next = !native();
      setNative(next);
      setNativeView(next);
    };

    const onNavigate = async (url: URL) => {
      const token = ++navToken;
      const pr = parsePrLocation(url);
      if (!pr || (pr.view !== 'changes' && pr.view !== 'files')) {
        teardown();
        return;
      }

      const payload = initialLoad
        ? (readEmbeddedChangesPayload() ??
          (await fetchChangesPayload(url.pathname)))
        : await fetchChangesPayload(url.pathname);
      initialLoad = false;
      if (token !== navToken) return;
      if (!payload) {
        console.warn('[hihyou] no changes payload for', url.pathname);
        teardown();
        return;
      }

      const mount = await waitForMount();
      if (token !== navToken) return;
      if (!mount) {
        console.warn('[hihyou] viewer container never appeared');
        teardown();
        return;
      }

      // React replaces the container when leaving/re-entering the changes
      // view; remount only when our root is gone.
      if (!rootEl?.isConnected || rootEl.parentElement !== mount.host) {
        teardown();
        rootEl = document.createElement('div');
        rootEl.className = ROOT_CLASS;
        mount.host.append(rootEl);
        dispose = render(
          () => (
            <DiffViewer data={data} native={native} onToggleNative={toggleNative} />
          ),
          rootEl,
        );
      }
      setNativeView(native());
      setData({ pr, payload });
      console.log(
        `[hihyou] ${payload.diffSummaries.length} files, ` +
          `${payload.commits.length} commits` +
          (pr.range ? `, range ${pr.range}` : ''),
      );
    };

    onNavigate(new URL(location.href));
    // GitHub is an SPA (turbo + React Router); WXT re-emits soft navigations.
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) =>
      onNavigate(newUrl),
    );

    // Dev self-reload: `window.postMessage({type: 'hihyou:reload'})` makes the
    // background re-read the unpacked extension from disk.
    ctx.addEventListener(window, 'message', (e) => {
      if (
        e.source === window &&
        (e.data as { type?: string })?.type === 'hihyou:reload'
      ) {
        browser.runtime.sendMessage({ type: 'hihyou:reload' }).catch(() => {});
      }
    });
  },
});
