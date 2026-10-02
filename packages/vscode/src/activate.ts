import * as vscode from "vscode";
import { type DiffsetTree, registerDiffsetsView } from "./diffsets/view.js";
import { outputChannel, reportError } from "./errors.js";
import { githubCommands } from "./github/command.js";
import { githubRemotes } from "./github/remotes.js";
import { localCommands } from "./local/commands.js";
import { localRepos, type OpenRepo } from "./local/repos.js";

/** What `activate` returns: the extension's exports, read by the integration test. */
export interface HihyouExports {
  /** Whether the GitHub commands are offered, once the latest remote scan has finished. */
  hasGitHubRemote(): Promise<boolean>;
  /** The `hihyou.diffsets` view's provider. */
  diffsets: DiffsetTree;
}

/** Everything both entries share; `open` is the runtime's way to reach a repository. */
export function activateWith(
  context: vscode.ExtensionContext,
  open: OpenRepo,
): HihyouExports {
  const repos = localRepos(open);
  context.subscriptions.push(repos, outputChannel());

  const diffsets = registerDiffsetsView(context, repos);
  const commands = {
    ...localCommands(context.extensionUri, repos),
    ...githubCommands(context, repos),
  };
  for (const [id, run] of Object.entries(commands))
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        try {
          // The posted files are the command's result, which is how the integration test observes a review.
          return await run();
        } catch (error) {
          reportError(`${id} failed`, error);
          return undefined;
        }
      }),
    );

  // GitHub is opt-in by the repository itself: its commands appear only when a remote points at github.com.
  const detect = async () => {
    let found = false;
    try {
      found = (await githubRemotes(await repos.all())).length > 0;
    } catch (error) {
      outputChannel().appendLine(
        `could not read git remotes: ${String(error)}`,
      );
    }
    await vscode.commands.executeCommand(
      "setContext",
      "hihyou.hasGitHubRemote",
      found,
    );
    return found;
  };
  let detected = detect();
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      detected = detect();
    }),
  );

  return { hasGitHubRemote: () => detected, diffsets };
}
