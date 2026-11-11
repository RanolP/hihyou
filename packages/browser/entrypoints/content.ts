import type { ContentScriptDefinition } from "wxt";
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { start } from "../src/content.js";
import {
  type FetchReply,
  fromBase64,
  grammarChunkFiles,
  type LoadReply,
  type ToBackground,
} from "../src/protocol.js";
import { enabledStorageKey } from "../src/privileged.js";

const grammarChunks = new Map<string, Promise<void>>();

/**
 * One injection per chunk, shared by every grammar in it. The chunks are asked for all at once, not one after
 * another, since each round trip to the worker waits on the page's main thread. A failed injection is
 * forgotten, so the next file tries again.
 */
function loadGrammarChunks(files: readonly string[]): Promise<void> {
  for (const file of files) {
    if (grammarChunks.has(file)) continue;
    const loading = (
      browser.runtime.sendMessage({
        type: "load-grammars",
        file,
      } satisfies ToBackground) as Promise<LoadReply>
    ).then((reply) => {
      if (!reply.ok) throw new Error(reply.error);
    });
    loading.catch(() => grammarChunks.delete(file));
    grammarChunks.set(file, loading);
  }
  return Promise.all(files.map((file) => grammarChunks.get(file))).then(
    () => {},
  );
}

const definition: ContentScriptDefinition = defineContentScript({
  matches: ["https://github.com/*"],
  runAt: "document_start",
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
          ...(reply.link && { headers: { Link: reply.link } }),
        });
      },
      async loadApp() {
        globalThis.hihyouLoadGrammarChunk ??= (file) =>
          loadGrammarChunks([file]);
        if (!globalThis.hihyouApp) {
          const loading = browser.runtime.sendMessage({
            type: "load-app",
          } satisfies ToBackground) as Promise<LoadReply>;
          // Every chunk goes in right behind app.js, while GitHub is still loading the page, so it is usually in
          // place by the time the first file asks for it.
          loadGrammarChunks(grammarChunkFiles).catch((error: unknown) =>
            console.warn("hihyou: could not preload the grammars", error),
          );
          const reply = await loading;
          if (!reply.ok) throw new Error(reply.error);
        }
        const app = globalThis.hihyouApp;
        if (!app)
          throw new Error("app.js was injected but registered no hihyouApp");
        return app;
      },
      async isEnabled() {
        const stored = await browser.storage.local.get(enabledStorageKey);
        return stored[enabledStorageKey] !== false;
      },
      onEnabledChanged(listener) {
        const changed = (
          changes: Record<string, { newValue?: unknown }>,
          areaName: string,
        ) => {
          if (areaName !== "local" || !(enabledStorageKey in changes)) return;
          listener(changes[enabledStorageKey]?.newValue !== false);
        };
        browser.storage.onChanged.addListener(changed);
        return () => browser.storage.onChanged.removeListener(changed);
      },
    });
  },
});
export default definition;
