import type { BackgroundDefinition } from "wxt";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import type { FetchReply, LoadReply, ToBackground } from "../src/protocol.js";
import { toBase64 } from "../src/protocol.js";
import { fetchable } from "../src/privileged.js";

// The content script cannot read `pull/<n>.diff` or `raw/...` itself: both redirect off github.com to hosts
// that send no CORS headers. The worker can, through the manifest's host permissions, and sends the browser's
// own github.com cookies with each request, so a private repository works for whoever is signed in. It fetches
// only github.com URLs (`fetchable`); redirects from there are followed as the browser would.

const definition: BackgroundDefinition = defineBackground(() => {
  browser.runtime.onMessage.addListener((raw, sender, reply) => {
    if (sender.id !== browser.runtime.id) return false;
    const message = raw as ToBackground;
    if (message.type === "fetch") {
      if (!fetchable.test(message.url)) {
        reply({
          ok: false,
          error: `refusing to fetch ${message.url}: only https://github.com/ URLs`,
        } satisfies FetchReply);
        return false;
      }
      proxy(message.url, message.accept).then(reply, (error: unknown) =>
        reply({
          ok: false,
          error: `fetch ${message.url}: ${String(error)}`,
        } satisfies FetchReply),
      );
      return true;
    }
    if (message.type === "load-app") {
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        reply({
          ok: false,
          error: "load-app came from no tab",
        } satisfies LoadReply);
        return false;
      }
      browser.scripting
        .executeScript({
          target: { tabId, frameIds: [sender.frameId ?? 0] },
          files: ["/app.js"],
        })
        .then(
          () => reply({ ok: true } satisfies LoadReply),
          (error: unknown) =>
            reply({
              ok: false,
              error: `injecting app.js: ${String(error)}`,
            } satisfies LoadReply),
        );
      return true;
    }
    return false;
  });
});

async function proxy(
  url: string,
  accept: string | undefined,
): Promise<FetchReply> {
  const response = await fetch(url, {
    credentials: "include",
    ...(accept && { headers: { Accept: accept } }),
  });
  return {
    ok: true,
    status: response.status,
    statusText: response.statusText,
    body: toBase64(new Uint8Array(await response.arrayBuffer())),
  };
}
export default definition;
