import * as vscode from "vscode";
import type { OpenedPullRequest } from "../github/command.js";
import type { LocalRepo } from "../local/repos.js";

/** The review source the user is looking at; the diffsets view lists only its diffsets. */
export type CurrentDiffsets =
  | { kind: "github"; opened: OpenedPullRequest }
  | { kind: "local"; local: LocalRepo };

let current: CurrentDiffsets | undefined;
const changed = new vscode.EventEmitter<CurrentDiffsets | undefined>();

export const onDidChangeCurrentDiffsets = changed.event;

export function currentDiffsets(): CurrentDiffsets | undefined {
  return current;
}

/** Called by the review commands; opening a row of the view itself reviews the same set, so it never calls this. */
export function setCurrentDiffsets(next: CurrentDiffsets | undefined): void {
  current = next;
  changed.fire(next);
}
