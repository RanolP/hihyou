import type { Theme } from "@hihyou/engine";
import { type DiffsetView, renderDiffset } from "@hihyou/ui";
import type { FromWebview, ToWebview } from "./protocol.js";

declare function acquireVsCodeApi(): {
  postMessage(message: FromWebview): void;
};

const vscode = acquireVsCodeApi();
const post = (message: FromWebview) => vscode.postMessage(message);

const title = document.getElementById("title") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;
const refresh = document.getElementById("refresh") as HTMLButtonElement;
const root = document.getElementById("root") as HTMLElement;
let view: DiffsetView | undefined;
let theme: Theme | undefined;

refresh.addEventListener("click", () => post({ type: "refresh" }));

window.addEventListener("message", (event: MessageEvent<ToWebview>) => {
  const message = event.data;
  if (message.type === "theme") {
    theme = message.theme;
    view?.setTheme(theme);
    return;
  }
  title.textContent = message.title;
  switch (message.type) {
    case "loading":
      status.textContent = "Loading…";
      status.className = "status";
      refresh.disabled = true;
      return;
    case "error":
      status.textContent = message.message;
      status.className = "status error";
      refresh.disabled = false;
      return;
    case "files":
      refresh.hidden = !message.refreshable;
      refresh.disabled = false;
      status.className = "status";
      status.textContent =
        message.files.length === 0
          ? "No changes."
          : `${message.files.length} ${message.files.length === 1 ? "file" : "files"} changed`;
      if (view) view.update(message.files);
      else
        view = renderDiffset(root, message.files, {
          onExpand: (path, elided) => post({ type: "expand", path, elided }),
          ...(theme && { theme }),
        });
  }
});

post({ type: "ready" });
