import { localHost, openRepo } from "@hihyou/git";
import type * as vscode from "vscode";
import { activateWith, type HihyouExports } from "./activate.js";

/** Desktop: the repository is read straight off the local disk. */
export function activate(context: vscode.ExtensionContext): HihyouExports {
  return activateWith(context, async (folder) => {
    const repo = openRepo(folder.fsPath);
    return { repo, host: localHost(repo) };
  });
}

export function deactivate(): void {}
