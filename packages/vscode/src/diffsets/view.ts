import type { ChangedFileRef } from "@hihyou/engine";
import * as vscode from "vscode";
import { outputChannel, reportError } from "../errors.js";
import type { OpenedPullRequest } from "../github/command.js";
import type { LocalRepos } from "../local/repos.js";
import { openReviewPanel } from "../panel/panel.js";
import { type FileTreeNode, fileTree } from "./file-tree.js";
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
  | {
      kind: "group";
      id: string;
      label: string;
      description?: string;
      children: () => Promise<Diffset[]>;
    }
  | DiffsetNode
  | {
      kind: "folder";
      owner: DiffsetNode;
      name: string;
      path: string;
      children: FileTreeNode<ChangedFileRef>[];
    }
  | { kind: "file"; owner: DiffsetNode; change: ChangedFileRef }
  | { kind: "message"; id: string; label: string };

export interface DiffsetTree {
  children(node?: DiffsetTreeNode): Promise<DiffsetTreeNode[]>;
  item(node: DiffsetTreeNode): vscode.TreeItem;
}

/**
 * The `hihyou.diffsets` view: each local repository's working tree, index and branch commits, plus the pull
 * request last opened, each expanding into the files it changes. Returns the provider, which the integration
 * test reads.
 */
export function registerDiffsetsView(
  context: vscode.ExtensionContext,
  repos: LocalRepos,
): { tree: DiffsetTree; showPullRequest(opened: OpenedPullRequest): void } {
  const changed = new vscode.EventEmitter<DiffsetTreeNode | undefined>();
  let pullRequest: OpenedPullRequest | undefined;
  let roots: Promise<DiffsetTreeNode[]> | undefined;
  /** Every diffset node of the current roots, cached so a refresh can name the same objects the view holds. */
  const nodesByKey = new Map<string, DiffsetNode>();

  const diffsetNodes = async (
    load: () => Promise<Diffset[]>,
    where: string,
  ) => {
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

  const loadRoots = async (): Promise<DiffsetTreeNode[]> => {
    nodesByKey.clear();
    const locals = await repos.all();
    const groups: DiffsetTreeNode[] = locals.map((local) => ({
      kind: "group",
      id: `local:${local.folder.uri.toString()}`,
      label: local.folder.name,
      children: () => localDiffsets(local),
    }));
    if (pullRequest) {
      const opened = pullRequest;
      groups.push({
        kind: "group",
        id: `github:${opened.remote.owner}/${opened.remote.repo}#${opened.pr.number}`,
        label: `#${opened.pr.number} ${opened.pr.title}`,
        description: `${opened.remote.owner}/${opened.remote.repo}`,
        children: () => pullRequestDiffsets(opened),
      });
    }
    // One repository and no pull request: its diffsets are the top level, with no group row above them.
    const [only] = groups;
    if (groups.length === 1 && only?.kind === "group")
      return diffsetNodes(only.children, only.label);
    return groups;
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
        case "group":
          return diffsetNodes(node.children, node.label);
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
          return node.children.map((n) => fileNode(node.owner, n));
        default:
          return [];
      }
    },
    item: treeItem,
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
      async (diffset: Diffset, focus?: string) => {
        try {
          await openReviewPanel(context.extensionUri, diffset.source, {
            key: diffset.key,
            ...(focus !== undefined && { focus }),
          });
        } catch (error) {
          reportError(`could not open ${diffset.label}`, error);
        }
      },
    ),
    vscode.workspace.onDidSaveTextDocument(() => {
      clearTimeout(timer);
      timer = setTimeout(refreshMoving, saveDebounceMs);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(refreshAll),
    { dispose: () => clearTimeout(timer) },
  );

  return {
    tree,
    showPullRequest(opened) {
      pullRequest = opened;
      refreshAll();
    },
  };
}

function fileNode(
  owner: DiffsetNode,
  node: FileTreeNode<ChangedFileRef>,
): DiffsetTreeNode {
  return node.kind === "folder"
    ? {
        kind: "folder",
        owner,
        name: node.name,
        path: node.path,
        children: node.children,
      }
    : { kind: "file", owner, change: node.file };
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
    case "group": {
      const item = new vscode.TreeItem(node.label, Expanded);
      item.id = node.id;
      if (node.description) item.description = node.description;
      return item;
    }
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
