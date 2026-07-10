/**
 * Dev self-reload, isolated in its own tiny content script so a crash in
 * the main script can never strand the extension on a broken build:
 * `window.postMessage({type: 'hihyou:reload'})` → background reloads the
 * unpacked extension from disk.
 */
export default defineContentScript({
  matches: ['https://github.com/*'],
  main(ctx) {
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
