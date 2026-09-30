import { createEngine, type Engine } from "@hihyou/engine";
import type { LocalHost, Repo } from "@hihyou/git";
import * as vscode from "vscode";

/**
 * How a runtime opens the repository containing a workspace folder: the only piece the desktop and the web
 * entry do differently.
 */
export type OpenRepo = (
  folder: vscode.Uri,
) => Promise<{ repo: Repo; host: LocalHost }>;

export interface LocalRepo {
  folder: vscode.WorkspaceFolder;
  repo: Repo;
  host: LocalHost;
  /** One per repository, so its blob and diff cache outlives a single panel. */
  engine: Engine<LocalHost>;
}

export interface LocalRepos extends vscode.Disposable {
  /** The repository to review: the only workspace folder's, or the one the user picks. */
  pick(): Promise<LocalRepo | undefined>;
  /** Every workspace folder that is inside a repository. */
  all(): Promise<LocalRepo[]>;
}

export function localRepos(open: OpenRepo): LocalRepos {
  const opened = new Map<string, Promise<LocalRepo>>();
  const get = (folder: vscode.WorkspaceFolder) => {
    const key = folder.uri.toString();
    let repo = opened.get(key);
    if (!repo) {
      repo = open(folder.uri).then(({ repo, host }) => ({
        folder,
        repo,
        host,
        engine: createEngine(host),
      }));
      // A folder that is not a repository yet may become one (`git init`), so a failure is not remembered.
      repo.catch(() => opened.delete(key));
      opened.set(key, repo);
    }
    return repo;
  };

  return {
    async pick() {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0)
        throw new Error("open a folder inside a git repository first");
      const folder =
        folders.length === 1
          ? folders[0]
          : await vscode.window.showWorkspaceFolderPick({
              placeHolder: "Repository to review",
            });
      return folder && get(folder);
    },
    async all() {
      const results = await Promise.allSettled(
        (vscode.workspace.workspaceFolders ?? []).map(get),
      );
      return results.flatMap((r) =>
        r.status === "fulfilled" ? [r.value] : [],
      );
    },
    dispose() {
      for (const repo of opened.values())
        repo.then(
          (r) => r.repo.close(),
          () => undefined,
        );
      opened.clear();
    },
  };
}
