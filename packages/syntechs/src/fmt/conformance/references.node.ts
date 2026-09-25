// The other formatters the matrix and the benchmark measure beside syntechs, as context: oxfmt (native, through
// its JS API) and dprint (its wasm plugins, through @dprint/formatter). Both take prettier's option names here;
// the conformance matrix scores them against prettier's expected output exactly as it scores syntechs.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createFromBuffer, type Formatter } from "@dprint/formatter";
import { getPath as dprintJson } from "@dprint/json";
import { getPath as dprintTypescript } from "@dprint/typescript";
import { format as oxfmtFormat } from "oxfmt";

const require = createRequire(import.meta.url);
const versionOf = (pkg: string): string =>
  (
    JSON.parse(
      readFileSync(require.resolve(`${pkg}/package.json`), "utf8"),
    ) as { version: string }
  ).version;

export interface Reference {
  /** Name and version, as the reports print it. */
  name: string;
  /**
   * Formats `text` as the file `file` (its name picks the language) with prettier-named `options`; throws when
   * the tool rejects the input or an option.
   */
  format(
    file: string,
    text: string,
    options: Record<string, unknown>,
  ): Promise<string>;
}

export const oxfmt: Reference = {
  name: `oxfmt ${versionOf("oxfmt")}`,
  async format(file, text, options) {
    // oxfmt reads prettier's option names and rejects the ones it lacks. It sorts package.json by default, which
    // prettier never does.
    const r = await oxfmtFormat(file, text, {
      sortPackageJson: false,
      ...options,
    });
    if (r.errors.length > 0)
      throw new Error(r.errors.map((e) => e.message).join("; "));
    return r.code;
  },
};

export type DprintPlugin = "json" | "css" | "typescript";

const pluginPaths: Record<DprintPlugin, () => string> = {
  json: dprintJson,
  typescript: dprintTypescript,
  css: () => require.resolve("dprint-plugin-malva/plugin.wasm"),
};

/**
 * dprint's settings nearest prettier's defaults, and the per-plugin mapping of prettier's options. An option
 * dprint has no equivalent for leaves dprint at this base, so such runs read as dprint's own style.
 */
const pluginBase: Record<DprintPlugin, Record<string, unknown>> = {
  json: {},
  css: { quotes: "preferDouble" },
  typescript: {
    quoteStyle: "preferDouble",
    quoteProps: "asNeeded",
    trailingCommas: "onlyMultiLine",
    "arrowFunction.useParentheses": "force",
  },
};

function pluginOptions(
  plugin: DprintPlugin,
  o: Record<string, unknown>,
): Record<string, unknown> {
  const c = { ...pluginBase[plugin] };
  if (plugin === "css" && o.singleQuote === true) c.quotes = "preferSingle";
  if (plugin !== "typescript") return c;
  if (o.semi === false) c.semiColons = "asi";
  if (o.singleQuote === true) c.quoteStyle = "preferSingle";
  if (o.jsxSingleQuote === true) c["jsx.quoteStyle"] = "preferSingle";
  if (o.trailingComma === "none") c.trailingCommas = "never";
  if (o.arrowParens === "avoid")
    c["arrowFunction.useParentheses"] = "preferNone";
  if (typeof o.quoteProps === "string")
    c.quoteProps = {
      "as-needed": "asNeeded",
      consistent: "consistent",
      preserve: "preserve",
    }[o.quoteProps];
  return c;
}

function globalOptions(o: Record<string, unknown>) {
  const eol = o.endOfLine ?? "lf";
  if (eol !== "lf" && eol !== "crlf" && eol !== "auto")
    throw new Error(`dprint has no endOfLine ${String(eol)}`);
  return {
    lineWidth:
      o.printWidth === Number.POSITIVE_INFINITY
        ? 2 ** 32 - 1
        : ((o.printWidth as number | undefined) ?? 80),
    indentWidth: (o.tabWidth as number | undefined) ?? 2,
    useTabs: o.useTabs === true,
    newLineKind: eol,
  } as const;
}

/** One dprint plugin instance, reconfigured only when a run's options differ from the last run's. */
export function dprint(plugin: DprintPlugin): Reference {
  const formatter: Formatter = createFromBuffer(
    readFileSync(pluginPaths[plugin]()),
  );
  const info = formatter.getPluginInfo();
  let configured: string | undefined;
  return {
    name: `dprint ${info.name} ${info.version}`,
    async format(file, text, options) {
      const global = globalOptions(options);
      const own = pluginOptions(plugin, options);
      const key = JSON.stringify([global, own]);
      if (key !== configured) {
        formatter.setConfig(global, own);
        const bad = formatter.getConfigDiagnostics();
        if (bad.length > 0)
          throw new Error(
            bad.map((d) => `${d.propertyName}: ${d.message}`).join("; "),
          );
        configured = key;
      }
      return formatter.formatText({ filePath: file, fileText: text });
    },
  };
}
