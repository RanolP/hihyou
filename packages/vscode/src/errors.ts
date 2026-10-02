import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function outputChannel(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel("Hihyou");
  return channel;
}

/** Shows the underlying message to the user and logs the full stack, so a report names the cause on its own. */
export function reportError(what: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof Error ? (error.stack ?? message) : message;
  outputChannel().appendLine(
    `[${new Date().toISOString()}] ${what}: ${detail}`,
  );
  void vscode.window.showErrorMessage(`Hihyou: ${what}: ${message}`);
}
