export default defineBackground(() => {
  console.log('[hihyou] background ready', { id: browser.runtime.id });

  // Dev self-reload: the content script forwards `hihyou:reload` from the
  // page; reloading re-reads the unpacked extension from disk.
  browser.runtime.onMessage.addListener((msg: unknown) => {
    if ((msg as { type?: string })?.type === 'hihyou:reload') {
      browser.runtime.reload();
    }
  });
});
