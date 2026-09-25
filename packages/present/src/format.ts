import type { Plugin } from "prettier";

export type Unformatted =
  | "unsupported-language"
  | "formatter-error"
  /** The formatter changed too many tokens to map edits onto its output. */
  | "unalignable";

export type FormatResult =
  | { ok: true; text: string }
  | { ok: false; reason: Unformatted; message?: string };

export interface Formatter {
  /** Never rejects: a file the formatter cannot handle comes back as a reason to show it unformatted. */
  format(path: string, text: string): Promise<FormatResult>;
}

export interface FormatterOptions {
  /**
   * `@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm`, supplied by the host because only it knows where the
   * file lives (a bundled asset, an extension URL, or a path on disk). A `fetch` Response compiles while
   * it downloads. Called on the first Python file, and again only if that load failed.
   */
  ruffWasm: () => Promise<Response | BufferSource>;
}

const prettierExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".scss",
  ".less",
  ".yaml",
  ".yml",
  ".md",
]);
const ruffExtensions = new Set([".py", ".pyi"]);

export function createFormatter({ ruffWasm }: FormatterOptions): Formatter {
  // Loaded on first use: prettier's plugins weigh about 2 MB and ruff about 11 MB.
  let prettier:
    | Promise<(path: string, text: string) => Promise<string>>
    | undefined;
  let ruff: Promise<(text: string) => string> | undefined;

  const loadPrettier = async () => {
    const [{ format }, ...plugins]: [
      typeof import("prettier/standalone"),
      ...Plugin[],
    ] = await Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/estree"),
      import("prettier/plugins/typescript"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/postcss"),
      import("prettier/plugins/yaml"),
      import("prettier/plugins/markdown"),
    ]);
    return (filepath: string, text: string) =>
      format(text, { filepath, plugins });
  };
  const loadRuff = async () => {
    const wasm = await import("@astral-sh/ruff-wasm-web");
    // Async: browsers refuse to compile a module this large synchronously on the main thread.
    await wasm.default({ module_or_path: await ruffWasm() });
    const workspace = new wasm.Workspace(
      wasm.Workspace.defaultSettings(),
      wasm.PositionEncoding.Utf16,
    );
    return (text: string) => workspace.format(text);
  };

  return {
    async format(path, text) {
      const ext = extension(path);
      try {
        if (prettierExtensions.has(ext)) {
          prettier ??= loadPrettier().catch((error: unknown) => {
            prettier = undefined;
            throw error;
          });
          return { ok: true, text: await (await prettier)(path, text) };
        }
        if (ruffExtensions.has(ext)) {
          ruff ??= loadRuff().catch((error: unknown) => {
            ruff = undefined;
            throw error;
          });
          return { ok: true, text: (await ruff)(text) };
        }
      } catch (error) {
        return {
          ok: false,
          reason: "formatter-error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      return { ok: false, reason: "unsupported-language" };
    },
  };
}

function extension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot <= path.lastIndexOf("/") ? "" : path.slice(dot).toLowerCase();
}
