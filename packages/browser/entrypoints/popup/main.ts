import { browser } from "wxt/browser";
import { enabledStorageKey } from "../../src/privileged.js";

/** `vX.Y.Z (commit)`, set by wxt.config.ts at build time. */
declare const __HIHYOU_VERSION__: string;

async function main() {
  const version = document.querySelector("#version");
  if (version) version.textContent = __HIHYOU_VERSION__;

  const input = document.querySelector<HTMLInputElement>("#enabled");
  if (!input) throw new Error("enabled switch is missing");

  const stored = await browser.storage.local.get(enabledStorageKey);
  input.checked = stored[enabledStorageKey] !== false;
  input.disabled = false;
  input.addEventListener("change", () => {
    void browser.storage.local.set({ [enabledStorageKey]: input.checked });
  });
}

void main();
