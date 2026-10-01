import type { Theme } from "@hihyou/engine";
import { type DiffsetView, renderDiffset } from "@hihyou/ui";
import type { FromWebview, ToWebview } from "./protocol.js";

declare function acquireVsCodeApi(): {
  postMessage(message: FromWebview): void;
  getState(): { focusSeq?: number } | undefined;
  setState(state: { focusSeq: number }): void;
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

let pendingFocus: { path: string; seq: number } | undefined;
const applyFocus = () => {
  if (!pendingFocus || !view) return;
  const { path, seq } = pendingFocus;
  const scroll = [...root.querySelectorAll<HTMLElement>(".hh-scroll")].find(
    (s) => s.dataset["path"] === path,
  );
  const section = scroll?.parentElement;
  if (!section) return;
  // The sticky bar would cover the file's header otherwise.
  section.style.scrollMarginTop = `${document.querySelector(".bar")?.clientHeight ?? 0}px`;
  section.scrollIntoView({ block: "start" });
  pendingFocus = undefined;
  vscode.setState({ focusSeq: seq });
};

window.addEventListener("message", (event: MessageEvent<ToWebview>) => {
  const message = event.data;
  if (message.type === "theme") {
    theme = message.theme;
    view?.setTheme(theme);
    return;
  }
  if (message.type === "focus") {
    if (message.seq > (vscode.getState()?.focusSeq ?? 0)) {
      pendingFocus = message;
      applyFocus();
    }
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
      applyFocus();
  }
});

post({ type: "ready" });
