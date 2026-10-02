import type { ChangedFileRef } from "@hihyou/engine";
import { type FileTreeNode, fileTree } from "@hihyou/ui";
import * as vscode from "vscode";
import { outputChannel, reportError } from "../errors.js";
import type { LocalRepos } from "../local/repos.js";
import { onDidShowFile, openReviewPanel, stepFile } from "../panel/panel.js";
import {
  type CurrentDiffsets,
  currentDiffsets,
  onDidChangeCurrentDiffsets,
  setCurrentDiffsets,
} from "./current.js";
import { type Diffset, localDiffsets, pullRequestDiffsets } from "./sources.js";

/** Saves closer together than this refresh the working tree and staged rows once. */
const saveDebounceMs = 300;

/** Carries a changed file's status in its query, for the decoration provider; never opened as a document. */
const changeScheme = "hihyou-change";

type Status = "A" | "D" | "M" | "R";

interface DiffsetNode {
  kind: "diffset";
  diffset: Diffset;
  /** Resolved on first expand, dropped on refresh. */
  files?: Promise<FileTreeNode<ChangedFileRef>[]> | undefined;
}

export type DiffsetTreeNode =
  | DiffsetNode
  | FolderNode
  | {
      kind: "file";
      owner: DiffsetNode;
      parent?: FolderNode | undefined;
      change: ChangedFileRef;
    }
  | { kind: "message"; id: string; label: string };

interface FolderNode {
  kind: "folder";
  owner: DiffsetNode;
  parent?: FolderNode | undefined;
  name: string;
  path: string;
  children: FileTreeNode<ChangedFileRef>[];
}

export interface DiffsetTree {
  children(node?: DiffsetTreeNode): Promise<DiffsetTreeNode[]>;
  item(node: DiffsetTreeNode): vscode.TreeItem;
}

/**
 * The `hihyou.diffsets` view: the diffsets of the current set only (a pull request: all changes and each commit;
 * a local repository: its working tree, index and branch commits), each expanding into the files it changes.
 * With no current set, a workspace of exactly one repository shows that repository. Returns the provider,
 * which the integration test reads.
 */
export function registerDiffsetsView(
  context: vscode.ExtensionContext,
  repos: LocalRepos,
): DiffsetTree {
  const changed = new vscode.EventEmitter<DiffsetTreeNode | undefined>();
  let roots: Promise<DiffsetTreeNode[]> | undefined;
  /** Every diffset node of the current roots, cached so a refresh can name the same objects the view holds. */
  const nodesByKey = new Map<string, DiffsetNode>();

  const diffsetNodes = async (
    load: () => Promise<Diffset[]>,
    where: string,
  ): Promise<DiffsetTreeNode[]> => {
    try {
      return (await load()).map((diffset): DiffsetTreeNode => {
        const node: DiffsetNode = { kind: "diffset", diffset };
        nodesByKey.set(diffset.key, node);
        return node;
      });
    } catch (error) {
      outputChannel().appendLine(`could not list ${where}: ${String(error)}`);
      return [errorNode(`${where}:error`, error)];
    }
  };

  const shown = async (): Promise<CurrentDiffsets | undefined> => {
    const current = currentDiffsets();
    if (current) return current;
    const locals = await repos.all();
    const [only] = locals;
    return locals.length === 1 && only
      ? { kind: "local", local: only }
      : undefined;
  };

  const loadRoots = async (): Promise<DiffsetTreeNode[]> => {
    nodesByKey.clear();
    const set = await shown();
    if (!set) {
      view.description = "";
      return [];
    }
    if (set.kind === "github") {
      const { opened } = set;
      view.description = `#${opened.pr.number} ${opened.pr.title}`;
      return diffsetNodes(() => pullRequestDiffsets(opened), view.description);
    }
    view.description = set.local.folder.name;
    return diffsetNodes(() => localDiffsets(set.local), view.description);
  };

  const files = (node: DiffsetNode) => {
    if (node.files) return node.files;
    const listing = node.diffset.changes().then((changes) => fileTree(changes));
    // A failed listing is not remembered, so expanding again retries.
    listing.catch(() => {
      if (node.files === listing) node.files = undefined;
    });
    return (node.files = listing);
  };

  const tree: DiffsetTree = {
    async children(node) {
      if (!node) return (roots ??= loadRoots());
      switch (node.kind) {
        case "diffset":
          try {
            const nodes = await files(node);
            return nodes.length === 0
              ? [
                  {
                    kind: "message",
                    id: `${node.diffset.key}:empty`,
                    label: "No changes",
                  },
                ]
              : nodes.map((n) => fileNode(node, n));
          } catch (error) {
            outputChannel().appendLine(
              `could not list the files of ${node.diffset.label}: ${String(error)}`,
            );
            return [errorNode(`${node.diffset.key}:error`, error)];
          }
        case "folder":
          return node.children.map((n) => fileNode(node.owner, n, node));
        default:
          return [];
      }
    },
    item: treeItem,
  };

  /** Selects the row of the file a panel shows, if its diffset is listed. */
  const revealFile = async (key: string, path: string) => {
    const owner = nodesByKey.get(key);
    if (!owner || !view.visible) return;
    try {
      let list = await files(owner);
      let parent: FolderNode | undefined;
      for (;;) {
        const hit = list.find((n) =>
          n.kind === "file"
            ? n.file.path === path
            : path.startsWith(`${n.path}/`),
        );
        if (!hit) return;
        const node = fileNode(owner, hit, parent);
        if (node.kind === "file") {
          await view.reveal(node, { select: true, focus: false });
          return;
        }
        if (node.kind !== "folder") return;
        parent = node;
        list = node.children;
      }
    } catch (error) {
      outputChannel().appendLine(
        `could not select ${path} in the diffsets view: ${String(error)}`,
      );
    }
  };

  const refreshAll = () => {
    roots = undefined;
    changed.fire(undefined);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refreshMoving = () => {
    for (const node of nodesByKey.values())
      if (node.diffset.moving && node.files) {
        node.files = undefined;
        changed.fire(node);
      }
  };

  const view = vscode.window.createTreeView("hihyou.diffsets", {
    treeDataProvider: {
      onDidChangeTreeData: changed.event,
      getChildren: (node) => tree.children(node),
      getTreeItem: treeItem,
      // `reveal` walks up from a file row to select it when a panel shows that file.
      getParent: (node) =>
        node.kind === "file" || node.kind === "folder"
          ? (node.parent ?? node.owner)
          : undefined,
    },
    showCollapseAll: true,
  });
  context.subscriptions.push(
    changed,
    view,
    vscode.window.registerFileDecorationProvider({
      provideFileDecoration: (uri) =>
        uri.scheme === changeScheme
          ? decorations[uri.query as Status]
          : undefined,
    }),
    vscode.commands.registerCommand("hihyou.refreshDiffsets", refreshAll),
    vscode.commands.registerCommand(
      "hihyou.openDiffset",
      async (diffset: Diffset, file?: string) => {
        try {
          await openReviewPanel(context.extensionUri, diffset.source, {
            key: diffset.key,
            ...(file !== undefined && { file }),
          });
        } catch (error) {
          reportError(`could not open ${diffset.label}`, error);
        }
      },
    ),
    vscode.commands.registerCommand("hihyou.nextFile", () => stepFile(1)),
    vscode.commands.registerCommand("hihyou.previousFile", () => stepFile(-1)),
    onDidShowFile(({ key, path }) => void revealFile(key, path)),
    vscode.workspace.onDidSaveTextDocument(() => {
      clearTimeout(timer);
      timer = setTimeout(refreshMoving, saveDebounceMs);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(({ removed }) => {
      const current = currentDiffsets();
      if (
        current?.kind === "local" &&
        removed.some(
          (f) => f.uri.toString() === current.local.folder.uri.toString(),
        )
      )
        setCurrentDiffsets(undefined);
      else refreshAll();
    }),
    onDidChangeCurrentDiffsets((current) => {
      refreshAll();
      // Opening a pull request brings the view forward, as the GitHub PR extension does.
      if (current?.kind === "github")
        void vscode.commands.executeCommand("hihyou.diffsets.focus");
    }),
    { dispose: () => clearTimeout(timer) },
  );

  return tree;
}

function fileNode(
  owner: DiffsetNode,
  node: FileTreeNode<ChangedFileRef>,
  parent?: FolderNode,
): DiffsetTreeNode {
  return node.kind === "folder"
    ? {
        kind: "folder",
        owner,
        parent,
        name: node.name,
        path: node.path,
        children: node.children,
      }
    : { kind: "file", owner, parent, change: node.file };
}

function errorNode(id: string, error: unknown): DiffsetTreeNode {
  const message = error instanceof Error ? error.message : String(error);
  return { kind: "message", id, label: `Could not load: ${message}` };
}

function status(change: ChangedFileRef): Status {
  if (change.before === null) return "A";
  if (change.after === null) return "D";
  return change.oldPath !== undefined ? "R" : "M";
}

const decorations: Record<Status, vscode.FileDecoration> = {
  A: new vscode.FileDecoration(
    "A",
    "Added",
    new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
  ),
  D: new vscode.FileDecoration(
    "D",
    "Deleted",
    new vscode.ThemeColor("gitDecoration.deletedResourceForeground"),
  ),
  M: new vscode.FileDecoration(
    "M",
    "Modified",
    new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
  ),
  R: new vscode.FileDecoration(
    "R",
    "Renamed",
    new vscode.ThemeColor("gitDecoration.renamedResourceForeground"),
  ),
};

function treeItem(node: DiffsetTreeNode): vscode.TreeItem {
  const { Collapsed, Expanded, None } = vscode.TreeItemCollapsibleState;
  switch (node.kind) {
    case "diffset": {
      const { diffset } = node;
      const item = new vscode.TreeItem(diffset.label, Collapsed);
      item.id = diffset.key;
      if (diffset.description) item.description = diffset.description;
      if (diffset.tooltip) item.tooltip = diffset.tooltip;
      item.iconPath = new vscode.ThemeIcon(
        diffset.moving ? "diff-multiple" : "git-commit",
      );
      item.contextValue = "diffset";
      item.command = {
        command: "hihyou.openDiffset",
        title: "Open Diff",
        arguments: [diffset],
      };
      return item;
    }
    case "folder": {
      const item = new vscode.TreeItem(node.name, Expanded);
      item.id = `${node.owner.diffset.key}|${node.path}/`;
      item.resourceUri = vscode.Uri.from({
        scheme: changeScheme,
        path: `/${node.path}`,
      });
      item.iconPath = vscode.ThemeIcon.Folder;
      return item;
    }
    case "file": {
      const { change, owner } = node;
      const item = new vscode.TreeItem(
        vscode.Uri.from({
          scheme: changeScheme,
          path: `/${change.path}`,
          query: status(change),
        }),
        None,
      );
      item.id = `${owner.diffset.key}|${change.path}`;
      item.iconPath = vscode.ThemeIcon.File;
      item.tooltip =
        change.oldPath !== undefined
          ? `${change.oldPath} → ${change.path}`
          : change.path;
      item.command = {
        command: "hihyou.openDiffset",
        title: "Open Diff",
        arguments: [owner.diffset, change.path],
      };
      return item;
    }
    case "message": {
      const item = new vscode.TreeItem(node.label, None);
      item.id = node.id;
      return item;
    }
  }
}
