import { localHost } from "@hihyou/git";
import { webRepo } from "@hihyou/git/web";
import type * as vscode from "vscode";
import { activateWith, type HihyouExports } from "./activate.js";
import { workspaceFileSystem } from "./local/workspace-fs.js";

/** Web (vscode.dev, github.dev): no Node, so the repository is read through `vscode.workspace.fs`. */
export function activate(context: vscode.ExtensionContext): HihyouExports {
  return activateWith(context, async (folder) => {
    const repo = await webRepo({
      fs: workspaceFileSystem(folder),
      path: folder.path,
    });
    return { repo, host: localHost(repo) };
  });
}

export function deactivate(): void {}
