import type { ContentScriptDefinition } from "wxt";
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { start } from "../src/content.js";
import {
  type FetchReply,
  fromBase64,
  type LoadReply,
  type ToBackground,
} from "../src/protocol.js";

const definition: ContentScriptDefinition = defineContentScript({
  matches: ["https://github.com/*"],
  runAt: "document_idle",
  main() {
    start({
      async fetch(url, init) {
        const reply: FetchReply = await browser.runtime.sendMessage({
          type: "fetch",
          url,
          ...(init?.accept && { accept: init.accept }),
        } satisfies ToBackground);
        if (!reply.ok) throw new Error(reply.error);
        const body =
          reply.status === 204 || reply.status === 304
            ? null
            : fromBase64(reply.body);
        return new Response(body, {
          status: reply.status,
          statusText: reply.statusText,
        });
      },
      async loadApp() {
        if (!globalThis.hihyouApp) {
          const reply: LoadReply = await browser.runtime.sendMessage({
            type: "load-app",
          } satisfies ToBackground);
          if (!reply.ok) throw new Error(reply.error);
        }
        const app = globalThis.hihyouApp;
        if (!app)
          throw new Error("app.js was injected but registered no hihyouApp");
        return app;
      },
    });
  },
});
export default definition;
