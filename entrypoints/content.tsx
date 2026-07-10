import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { DiffViewer, type ViewerData } from '@/components/DiffViewer';
import '@/components/diff-viewer.css';
import 'shiki-magic-move/style.css';
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
    let lastHandledHref: string | null = null;
    // Our own soft navigations bypass GitHub's router, leaving the hidden
    // native view stale; reload if the user toggles back to it.
    let nativeStale = false;

    const [data, setData] = createSignal<ViewerData | null>(null);
    const [prevData, setPrevData] = createSignal<ViewerData | null>(null);
    const [native, setNative] = createSignal(false);
    let rootEl: HTMLElement | null = null;
    let dispose: (() => void) | null = null;

    const teardown = () => {
      dispose?.();
      dispose = null;
      rootEl?.remove();
      rootEl = null;
      setData(null);
      setPrevData(null);
      releaseTakeover();
    };

    const toggleNative = () => {
      const next = !native();
      if (next && nativeStale) {
        location.reload();
        return;
      }
      setNative(next);
      setNativeView(next);
    };

    const softNavigate = (url: string) => {
      history.pushState(null, '', url);
      nativeStale = true;
      void onNavigate(new URL(location.href));
    };

    const onNavigate = async (url: URL) => {
      if (url.href === lastHandledHref && data()) return;
      const token = ++navToken;
      const pr = parsePrLocation(url);
      if (!pr || (pr.view !== 'changes' && pr.view !== 'files')) {
        lastHandledHref = null;
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
            <DiffViewer
              data={data}
              prev={prevData}
              native={native}
              onToggleNative={toggleNative}
              onNavigate={softNavigate}
            />
          ),
          rootEl,
        );
      }
      setNativeView(native());
      lastHandledHref = url.href;
      setPrevData(data());
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

    // React hydration (and later re-renders) can drop our foreign root or
    // wipe the visibility attribute — the content script runs at
    // document_idle, often mid-hydration. Watch and remount.
    ctx.setInterval(() => {
      if (!data()) return;
      if (!rootEl?.isConnected) {
        lastHandledHref = null;
        void onNavigate(new URL(location.href));
      } else {
        setNativeView(native());
      }
    }, 1000);

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
