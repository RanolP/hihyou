import type { Theme } from "@hihyou/engine";
import {
  type DiffFile,
  type DiffsetView,
  renderDiffset,
} from "@hihyou/ui";
import type { FromWebview, ToWebview } from "./protocol.js";

declare function acquireVsCodeApi(): {
  postMessage(message: FromWebview): void;
};

const vscode = acquireVsCodeApi();
const post = (message: FromWebview) => vscode.postMessage(message);

const title = document.getElementById("title") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;
const refresh = document.getElementById("refresh") as HTMLButtonElement;
const previous = document.getElementById("previous") as HTMLButtonElement;
const next = document.getElementById("next") as HTMLButtonElement;
const position = document.getElementById("position") as HTMLElement;
const root = document.getElementById("root") as HTMLElement;
let view: DiffsetView | undefined;
let theme: Theme | undefined;
let files: DiffFile[] = [];
/** The host's `show` that arrived before the files did. */
let wanted: string | undefined;

const index = () => files.findIndex((f) => f.path === view?.shown());
const updateNav = () => {
  const i = index();
  previous.disabled = i <= 0;
  next.disabled = i < 0 || i >= files.length - 1;
  position.textContent = i < 0 ? "" : `${i + 1} / ${files.length}`;
};
const step = (delta: 1 | -1) => {
  const target = files[index() + delta];
  if (!view || !target) return;
  view.show(target.path);
  post({ type: "shown", path: target.path });
  updateNav();
};

refresh.addEventListener("click", () => post({ type: "refresh" }));
previous.addEventListener("click", () => step(-1));
next.addEventListener("click", () => step(1));

window.addEventListener("message", (event: MessageEvent<ToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case "theme":
      theme = message.theme;
      view?.setTheme(theme);
      return;
    case "show":
      if (view) view.show(message.path);
      else wanted = message.path;
      updateNav();
      return;
    case "step":
      step(message.delta);
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
      files = message.files;
      refresh.hidden = !message.refreshable;
      refresh.disabled = false;
      status.className = "status";
      status.textContent =
        files.length === 0
          ? "No changes."
          : `${files.length} ${files.length === 1 ? "file" : "files"} changed`;
      if (view) view.update(files);
      else
        view = renderDiffset(root, files, {
          onExpand: (path, elided, direction) =>
            post({ type: "expand", path, elided, direction }),
          onCollapse: (path, elided) =>
            post({ type: "collapse", path, elided }),
          onShow: (path) => {
            post({ type: "shown", path });
            updateNav();
          },
          ...(theme && { theme }),
        });
      if (wanted !== undefined) view.show(wanted);
      wanted = undefined;
      updateNav();
  }
});

post({ type: "ready" });
