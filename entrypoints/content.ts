export default defineContentScript({
  matches: ['https://github.com/*'],
  main(ctx) {
    // Only the initial hard load can trust the embedded payload; GitHub's
    // React app soft-navigates between commits and leaves it stale.
    let initialLoad = true;

    const onNavigate = async (url: URL) => {
      const pr = parsePrLocation(url);
      if (!pr) return;
      console.log('[hihyou] PR page:', pr);
      if (pr.view !== 'changes' && pr.view !== 'files') return;

      const payload = initialLoad
        ? (readEmbeddedChangesPayload() ??
          (await fetchChangesPayload(url.pathname)))
        : await fetchChangesPayload(url.pathname);
      initialLoad = false;
      if (!payload) {
        console.warn('[hihyou] no changes payload for', url.pathname);
        return;
      }

      const mounted = payload.diffSummaries.filter(
        (s) => diffContainer(s) !== null,
      ).length;
      console.log(
        `[hihyou] ${payload.diffSummaries.length} files ` +
          `(${mounted} rendered), ${payload.commits.length} commits` +
          (payload.commit ? `, viewing ${payload.commit.oid.slice(0, 8)}` : ''),
      );
    };

    onNavigate(new URL(location.href));
    // GitHub is an SPA (turbo + React Router); WXT re-emits soft navigations.
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) =>
      onNavigate(newUrl),
    );
  },
});
