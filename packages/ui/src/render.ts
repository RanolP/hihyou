import {
  type CollapseReason,
  type CompiledTheme,
  compileTheme,
  type LinePair,
  type Span,
  type Theme,
} from "@hihyou/engine";
import { findCounterpart, type SideRef } from "./moves.js";
import {
  buildSections,
  type Cell,
  type DiffFile,
  lineCounts,
  type Row,
  type SideName,
  statusOf,
} from "./rows.js";

/** An `elided` fragment the reviewer asked to see. */
export interface ElidedRef {
  /** Index into `FileDiff.fragments`. */
  fragment: number;
  lines: LinePair;
  /** Lines hidden; absent when the run reaches the end of the file. */
  count?: number;
}

export interface RenderOptions {
  /**
   * The reviewer asked to see an elided run. `fileId` is `FileDiff.path`. `diff()` returns no text for an
   * elided run, so the host asks `Diffset.expand` for it and answers with `update`, that fragment replaced by
   * the `unchanged` one it returned.
   * Without this callback an elided run shows as a plain note.
   */
  onExpand?(fileId: string, elided: ElidedRef): void;
  /** Colours `Span.scope`: a VS Code theme, `include`s already followed. Without one, code is drawn uncoloured. */
  theme?: Theme;
}

export interface DiffsetView {
  /** Redraws with new files, keeping which collapsed files are open and each file's scroll position. */
  update(files: readonly DiffFile[]): void;
  /** Redraws with another theme, as `update` keeps state. */
  setTheme(theme: Theme | undefined): void;
  dispose(): void;
}

const reasons: Record<CollapseReason, string> = {
  generated: "Generated file",
  lockfile: "Lockfile",
  binary: "Binary file",
  submodule: "Submodule",
  "too-large": "Too large for a syntax diff",
  "parse-error": "Did not parse cleanly",
  "format-only": "Only formatting changed",
  moved: "Only moved code",
};

const markers: Record<SideName, string> = { before: "- ", after: "+ " };

/**
 * Draws `files` into `root` as one split table per file. All text goes in through `textContent`, and the
 * styles are not injected: put `diffStyles` into the page.
 */
export function renderDiffset(
  root: HTMLElement,
  files: readonly DiffFile[],
  opts: RenderOptions = {},
): DiffsetView {
  const doc = root.ownerDocument;
  let current = files;
  const opened = new Set<string>();
  const actions = new WeakMap<Element, () => void>();
  let fragmentRows = new Map<string, HTMLTableRowElement[]>();
  let theme: CompiledTheme | undefined = opts.theme && compileTheme(opts.theme);

  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const button = (text: string, action: () => void) => {
    const b = el("button", "hh-button", text);
    b.type = "button";
    actions.set(b, action);
    return b;
  };
  const wide = (tr: HTMLTableRowElement, className: string) => {
    const td = el("td", className);
    td.colSpan = 4;
    tr.append(td);
    return td;
  };

  /** Syntax colour inside, diff emphasis (a background) around it, so both show. */
  const spanNode = (span: Span, side: SideName): Node => {
    let node: Node = doc.createTextNode(span.text);
    const style = span.scope !== undefined ? theme?.style(span.scope) : undefined;
    if (style?.foreground || style?.fontStyle) {
      const token = el("span");
      if (style.foreground) token.style.color = style.foreground;
      const font = style.fontStyle ?? "";
      if (font.includes("italic")) token.style.fontStyle = "italic";
      if (font.includes("bold")) token.style.fontWeight = "bold";
      const lines = ["underline", "strikethrough"].filter((l) => font.includes(l));
      if (lines.length > 0) token.style.textDecoration = lines.join(" ").replace("strikethrough", "line-through");
      token.append(node);
      node = token;
    }
    if (!span.changed) return node;
    const mark = el(side === "before" ? "del" : "ins", "hh-changed");
    mark.append(node);
    return mark;
  };

  const cells = (
    tr: HTMLTableRowElement,
    side: SideName,
    cell: Cell | undefined,
    changed: boolean,
  ) => {
    const kind = changed
      ? side === "before"
        ? " hh-removed"
        : " hh-added"
      : "";
    if (!cell) {
      tr.append(el("td", "hh-num hh-empty"), el("td", "hh-code hh-empty"));
      return;
    }
    const code = el("td", `hh-code${kind}`);
    if (changed) code.append(el("span", "hh-sr", markers[side]));
    code.append(...cell.spans.map((s) => spanNode(s, side)));
    tr.append(el("td", `hh-num${kind}`, String(cell.line)), code);
  };

  const moveRow = (file: number, row: Row & { kind: "diff" }) => {
    const tr = el("tr", "hh-move");
    for (const side of ["before", "after"] as const) {
      const td = el("td", "hh-move-cell");
      td.colSpan = 2;
      tr.append(td);
      const move = row.move?.[side];
      if (!move) continue;
      const from: SideRef = { file, fragment: row.fragment, side };
      const to = findCounterpart(current, from);
      const target = to && current[to.file]?.fragments[to.fragment];
      const where =
        target?.kind === "diff" && to
          ? `${to.file === file ? "line " : `${move.counterpart.path}:`}${target[to.side].startLine}`
          : move.counterpart.path;
      const text = `${side === "before" ? "Moved to" : "Moved from"} ${where}`;
      td.append(to ? button(text, () => jump(to)) : el("span", "", text));
    }
    return tr;
  };

  const elidedRow = (path: string, row: Row & { kind: "elided" }) => {
    const tr = el("tr", "hh-elided");
    const td = wide(tr, "hh-elided-cell");
    const lines =
      row.count === undefined
        ? "unchanged lines"
        : `${row.count} unchanged ${row.count === 1 ? "line" : "lines"}`;
    const onExpand = opts.onExpand;
    if (!onExpand) {
      td.textContent = `Hidden: ${lines}`;
      return tr;
    }
    const ref: ElidedRef = {
      fragment: row.fragment,
      lines: row.lines,
      ...(row.count !== undefined && { count: row.count }),
    };
    const b = button(`Show ${lines}`, () => {
      b.disabled = true;
      b.setAttribute("aria-busy", "true");
      onExpand(path, ref);
    });
    td.append(b);
    return tr;
  };

  const lineRow = (index: number, row: Row, tbody: HTMLElement) => {
    if (row.kind === "elided") {
      tbody.append(elidedRow(current[index]?.path ?? "", row));
      return;
    }
    const tr = el("tr", "hh-line");
    const changed = row.kind === "diff";
    cells(tr, "before", row.before, changed);
    cells(tr, "after", row.after, changed);
    if (row.kind === "diff") {
      if (row.move) tbody.append(moveRow(index, row));
      const key = `${index}:${row.fragment}`;
      const list = fragmentRows.get(key) ?? [];
      list.push(tr);
      fragmentRows.set(key, list);
    }
    tbody.append(tr);
  };

  const table = (index: number, file: DiffFile) => {
    const t = el("table", "hh-table");
    t.append(el("caption", "hh-sr", `Split diff of ${file.path}`));
    const colgroup = el("colgroup");
    for (const c of ["hh-col-num", "hh-col-code", "hh-col-num", "hh-col-code"])
      colgroup.append(el("col", c));
    t.append(colgroup);
    const head = el("tr");
    for (const [label, hidden] of [
      ["Before line", true],
      ["Before", false],
      ["After line", true],
      ["After", false],
    ] as const) {
      const th = el("th");
      th.scope = "col";
      th.append(el("span", hidden ? "hh-sr" : "", label));
      head.append(th);
    }
    const thead = el("thead", "hh-head");
    thead.append(head);
    t.append(thead);

    const reason = file.collapsed?.reason;
    if (reason && !opened.has(file.path)) {
      const tbody = el("tbody");
      const tr = el("tr", "hh-collapsed");
      const td = wide(tr, "hh-collapsed-cell");
      td.append(el("span", "", reasons[reason]));
      if (file.fragments.length > 0)
        td.append(
          " ",
          button("Show diff", () => {
            opened.add(file.path);
            draw();
          }),
        );
      tbody.append(tr);
      t.append(tbody);
      return t;
    }

    // A sticky row sticks for the rest of the table, not just its own tbody, so every section after the
    // first carries a header, even at top level, to cover the one before it.
    for (const [i, section] of buildSections(file).entries()) {
      const tbody = el("tbody");
      if (i > 0 || section.path.length > 0) {
        const tr = el("tr", "hh-node");
        const th = el("th");
        th.scope = "rowgroup";
        th.colSpan = 4;
        th.append(
          section.path.length > 0
            ? el("span", "hh-node-label", section.path.join(" › "))
            : el("span", "hh-node-label hh-top", "top level"),
        );
        tr.append(th);
        tbody.append(tr);
      }
      for (const row of section.rows) lineRow(index, row, tbody);
      t.append(tbody);
    }
    return t;
  };

  const header = (file: DiffFile) => {
    const h = el("header", "hh-file-header");
    const title = el("h2", "hh-path");
    const oldPath = file.change?.oldPath;
    if (oldPath !== undefined && oldPath !== file.path)
      title.append(el("span", "hh-old-path", oldPath), " → ");
    title.append(el("span", "", file.path));
    h.append(title);
    if (file.change) {
      const status = statusOf(file.change);
      h.append(el("span", `hh-status hh-status-${status}`, status));
    }
    if (file.fragments.length > 0) {
      const { added, removed } = lineCounts(file);
      const counts = el("span", "hh-counts");
      counts.setAttribute(
        "aria-label",
        `${added} lines added, ${removed} lines removed`,
      );
      counts.append(
        el("span", "hh-count-added", `+${added}`),
        " ",
        el("span", "hh-count-removed", `−${removed}`),
      );
      h.append(counts);
    }
    return h;
  };

  const draw = () => {
    const scrolls = new Map<string, [number, number]>();
    for (const s of root.querySelectorAll<HTMLElement>(".hh-scroll")) {
      const path = s.dataset["path"];
      if (path !== undefined) scrolls.set(path, [s.scrollTop, s.scrollLeft]);
    }
    fragmentRows = new Map();
    const list = el("div", "hh-diff");
    for (const [index, file] of current.entries()) {
      const section = el("section", "hh-file");
      const scroll = el("div", "hh-scroll");
      scroll.dataset["path"] = file.path;
      scroll.append(table(index, file));
      section.append(header(file), scroll);
      list.append(section);
    }
    root.replaceChildren(list);
    for (const s of root.querySelectorAll<HTMLElement>(".hh-scroll")) {
      const saved = scrolls.get(s.dataset["path"] ?? "");
      if (saved) [s.scrollTop, s.scrollLeft] = saved;
    }
  };

  const jump = (to: SideRef) => {
    const file = current[to.file];
    if (file?.collapsed && !opened.has(file.path)) {
      opened.add(file.path);
      draw();
    }
    const rows = fragmentRows.get(`${to.file}:${to.fragment}`);
    const first = rows?.[0];
    if (!rows || !first) return;
    first.scrollIntoView({ block: "center" });
    first.tabIndex = -1;
    first.focus({ preventScroll: true });
    for (const r of rows) {
      r.classList.remove("hh-flash");
      // Reading layout restarts the animation on a row still flashing from an earlier jump.
      void r.offsetWidth;
      r.classList.add("hh-flash");
      r.addEventListener("animationend", () => r.classList.remove("hh-flash"), {
        once: true,
      });
    }
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    const b = target?.closest("button");
    if (b) actions.get(b)?.();
  };
  root.addEventListener("click", onClick);
  draw();

  return {
    update(files) {
      current = files;
      draw();
    },
    setTheme(next) {
      theme = next && compileTheme(next);
      draw();
    },
    dispose() {
      root.removeEventListener("click", onClick);
      root.replaceChildren();
    },
  };
}
