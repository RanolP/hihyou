import type { Theme } from "@hihyou/engine";
import {
  type CommentStore,
  type DiffFile,
  type DiffsetView,
  type ReviewNote,
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

/** The host's comments, when it keeps them (a pull request); absent, the view keeps its own. */
let hostComments: { notes: ReviewNote[]; reviewing: boolean } | undefined;
const commentListeners = new Set<() => void>();
const calls = new Map<
  number,
  { resolve: () => void; reject: (error: Error) => void }
>();
let lastCall = 0;
const call = (send: (id: number) => void) =>
  new Promise<void>((resolve, reject) => {
    const id = ++lastCall;
    calls.set(id, { resolve, reject });
    send(id);
  });
const proxyComments: CommentStore = {
  all: () => hostComments?.notes ?? [],
  reviewing: () => hostComments?.reviewing ?? false,
  comment: (anchor, body) =>
    call((id) => post({ type: "comment", id, how: "comment", anchor, body })),
  review: (anchor, body) =>
    call((id) => post({ type: "comment", id, how: "review", anchor, body })),
  reply: (thread, body) =>
    call((id) => post({ type: "reply", id, how: "reply", thread, body })),
  reviewReply: (thread, body) =>
    call((id) => post({ type: "reply", id, how: "reviewReply", thread, body })),
  submitReview: (event) =>
    call((id) => post({ type: "submitReview", id, event })),
  subscribe: (listener) => {
    commentListeners.add(listener);
    return () => commentListeners.delete(listener);
  },
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
    case "comments":
      hostComments = { notes: message.notes, reviewing: message.reviewing };
      for (const l of commentListeners) l();
      return;
    case "commented": {
      const pending = calls.get(message.id);
      calls.delete(message.id);
      if (message.error === undefined) pending?.resolve();
      else pending?.reject(new Error(message.error));
      return;
    }
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
          ...(hostComments && { comments: proxyComments }),
        });
      if (wanted !== undefined) view.show(wanted);
      wanted = undefined;
      updateNav();
  }
});

post({ type: "ready" });
