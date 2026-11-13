import { browser } from "wxt/browser";
import { enabledStorageKey } from "../../src/privileged.js";

async function main() {
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
