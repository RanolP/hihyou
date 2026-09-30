import type * as vscode from "vscode";
import { activateWith, type HihyouExports } from "./activate.js";

/** Web (vscode.dev, github.dev): no Node, so the repository must be read through `vscode.workspace.fs`. */
export function activate(context: vscode.ExtensionContext): HihyouExports {
  return activateWith(context, async (folder) => {
    // Waits on `@hihyou/git/web`, whose repository reader takes a file-system port instead of Node's fs.
    throw new Error(
      `reading a local repository is not supported on the web yet (${folder.toString()})`,
    );
  });
}

export function deactivate(): void {}
