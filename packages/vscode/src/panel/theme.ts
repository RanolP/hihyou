import type { Theme } from "@hihyou/engine";
import { githubDark, githubLight } from "@hihyou/ui";
import * as vscode from "vscode";
import { outputChannel } from "../errors.js";
import { parseJsonc } from "./jsonc.js";

type Rules = NonNullable<Theme["tokenColors"]>;

/**
 * The token colours of the active colour theme, read from the extension that contributes it and its `include`
 * chain. A theme that cannot be read (a `.tmTheme`, a file the host does not serve) falls back to GitHub Dark or
 * Light by the theme's kind, so the panel is always coloured.
 */
export async function activeTheme(): Promise<Theme> {
  const id = vscode.workspace
    .getConfiguration("workbench")
    .get<string>("colorTheme");
  try {
    for (const ext of vscode.extensions.all) {
      const themes: { id?: string; label?: string; path?: string }[] =
        ext.packageJSON?.contributes?.themes ?? [];
      const found = themes.find((t) => (t.id ?? t.label) === id);
      if (found?.path === undefined) continue;
      const tokenColors = await readRules(
        vscode.Uri.joinPath(ext.extensionUri, found.path),
        0,
      );
      if (tokenColors.length > 0) return { tokenColors };
      break;
    }
  } catch (error) {
    // Expected for a .tmTheme or a host that does not serve the file; the fallback below still colours.
    outputChannel().appendLine(
      `[${new Date().toISOString()}] colour theme ${id ?? "(unset)"} unreadable, using GitHub colours: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light ||
    kind === vscode.ColorThemeKind.HighContrastLight
    ? githubLight
    : githubDark;
}

/** Rules of `uri` after those of the theme it `include`s, as VS Code layers them. */
async function readRules(uri: vscode.Uri, depth: number): Promise<Rules> {
  if (depth > 8)
    throw new Error(`theme include chain too deep at ${uri.toString()}`);
  if (!uri.path.endsWith(".json"))
    throw new Error(`not a JSON theme: ${uri.toString()}`);
  const json = parseJsonc(
    new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
  ) as { include?: string; tokenColors?: string | Rules; settings?: Rules };
  const dir = vscode.Uri.joinPath(uri, "..");
  const base = json.include
    ? await readRules(vscode.Uri.joinPath(dir, json.include), depth + 1)
    : [];
  const own =
    typeof json.tokenColors === "string"
      ? await readRules(vscode.Uri.joinPath(dir, json.tokenColors), depth + 1)
      : (json.tokenColors ?? json.settings ?? []);
  return [...base, ...own];
}
