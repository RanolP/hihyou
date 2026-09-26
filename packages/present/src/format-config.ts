import type { Vcs } from "@hihyou/engine";
import JSON5 from "json5";
import picomatch from "picomatch/posix.js";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

/**
 * A repo's formatter settings, found the way prettier and ruff find them, so a review formats code the
 * way its authors do. Options keep each tool's own names; the reviewer's own settings go on top through
 * `mergeOptions`.
 */
export interface DiscoveredConfig<O> {
  options: Partial<O>;
  /** Repo path of the config file the options came from, or null when there is none. */
  source: string | null;
  /** Why some or all of the repo's settings were not applied, worded for the reader of the review. */
  unsupported: string[];
}

export interface PrettierOptions {
  printWidth: number;
  tabWidth: number;
  useTabs: boolean;
  semi: boolean;
  singleQuote: boolean;
  jsxSingleQuote: boolean;
  quoteProps: "as-needed" | "consistent" | "preserve";
  trailingComma: "all" | "es5" | "none";
  bracketSpacing: boolean;
  bracketSameLine: boolean;
  arrowParens: "always" | "avoid";
  endOfLine: "lf" | "crlf" | "cr" | "auto";
  objectWrap: "preserve" | "collapse";
}

/** Ruff's names, with `[format]` table keys flattened to `format.<key>`. */
export interface RuffOptions {
  "line-length": number;
  "indent-width": number;
  "format.quote-style": "double" | "single" | "preserve";
  "format.indent-style": "space" | "tab";
  "format.skip-magic-trailing-comma": boolean;
  "format.line-ending": "auto" | "lf" | "cr-lf" | "native";
}

/**
 * Per key: the repo's config, then only the keys the reviewer explicitly set. The formatter's own defaults
 * (syntechs' per language) fill in whatever neither sets.
 */
export function mergeOptions<O extends object>(
  repo: Partial<O>,
  reviewer: Partial<O>,
): Partial<O> {
  const set = (o: Partial<O>) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return { ...set(repo), ...set(reviewer) } as Partial<O>;
}

export interface FormatConfigResolver {
  /** `path` is repo-relative with `/` separators; the search walks up from its directory to the repo root. */
  prettier(
    revision: string,
    path: string,
  ): Promise<DiscoveredConfig<PrettierOptions>>;
  ruff(revision: string, path: string): Promise<DiscoveredConfig<RuffOptions>>;
}

/** Caches the search per (revision, directory), so the files of one diff share their lookups. */
export function createFormatConfigResolver(
  vcs: Pick<Vcs, "read">,
): FormatConfigResolver {
  const decoder = new TextDecoder();
  // Vcs.read has no not-found signal, so any failure reads as "no such file".
  const readText = (revision: string, path: string) =>
    vcs.read(revision, path).then(
      (bytes) => decoder.decode(bytes),
      () => undefined,
    );
  const nearestPrettier = nearest((revision, dir) =>
    prettierIn(dir, (name) => readText(revision, join(dir, name))),
  );
  const nearestRuff = nearest((revision, dir) =>
    ruffIn(dir, (name) => readText(revision, join(dir, name))),
  );

  return {
    async prettier(revision, path) {
      const found = await nearestPrettier(revision, dirname(path));
      if (!found) return { options: {}, source: null, unsupported: [] };
      const unsupported = [...found.unsupported];
      const merged = applyOverrides(found, path, unsupported);
      return {
        options: validate(merged, prettierRules, found.path, unsupported),
        source: found.path,
        unsupported,
      };
    },
    async ruff(revision, path) {
      const found = await nearestRuff(revision, dirname(path));
      if (!found) return { options: {}, source: null, unsupported: [] };
      const unsupported = [...found.unsupported];
      return {
        options: validate(found.config, ruffRules, found.path, unsupported),
        source: found.path,
        unsupported,
      };
    },
  };
}

interface Found {
  path: string;
  config: Record<string, unknown>;
  unsupported: string[];
}

function nearest(
  inDir: (revision: string, dir: string) => Promise<Found | null>,
): (revision: string, dir: string) => Promise<Found | null> {
  const cache = new Map<string, Promise<Found | null>>();
  const search = (revision: string, dir: string): Promise<Found | null> => {
    const key = `${revision}\0${dir}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = inDir(revision, dir).then(
        (found) =>
          found ?? (dir === "" ? null : search(revision, dirname(dir))),
      );
      cache.set(key, hit);
    }
    return hit;
  };
  return search;
}

// prettier 3.9.9 src/config/prettier-config/config-searcher.js, in order. The first one present in a
// directory wins, except that package.json/package.yaml count only when they carry a "prettier" key.
const prettierFiles = [
  "package.json",
  "package.yaml",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yml",
  ".prettierrc.yaml",
  ".prettierrc.json5",
  ".prettierrc.js",
  "prettier.config.js",
  ".prettierrc.ts",
  "prettier.config.ts",
  ".prettierrc.mjs",
  "prettier.config.mjs",
  ".prettierrc.mts",
  "prettier.config.mts",
  ".prettierrc.cjs",
  "prettier.config.cjs",
  ".prettierrc.cts",
  "prettier.config.cts",
  ".prettierrc.toml",
];

async function prettierIn(
  dir: string,
  read: (name: string) => Promise<string | undefined>,
): Promise<Found | null> {
  const texts = await Promise.all(prettierFiles.map(read));
  for (const [i, name] of prettierFiles.entries()) {
    const text = texts[i];
    if (text === undefined) continue;
    const path = join(dir, name);
    const found = (
      config: Record<string, unknown>,
      ...unsupported: string[]
    ) => ({
      path,
      config,
      unsupported,
    });
    if (/\.[cm]?[jt]s$/.test(name))
      return found(
        {},
        `${path}: a JavaScript config cannot be evaluated here, so prettier's defaults are used`,
      );
    let value: unknown;
    try {
      value = parsePrettierFile(name, text);
    } catch (error) {
      // Prettier skips a package file it cannot parse, but fails on any other config file.
      if (name.startsWith("package.")) continue;
      return found({}, `${path}: could not be parsed (${message(error)})`);
    }
    if (name.startsWith("package.")) {
      value = isObject(value) ? value.prettier : undefined;
      if (!value) continue;
    }
    if (value === undefined || value === null) return found({});
    if (typeof value === "string")
      return found(
        {},
        `${path}: the shareable config "${value}" cannot be loaded here, so prettier's defaults are used`,
      );
    if (!isObject(value))
      return found({}, `${path}: a config must be an object`);
    const { $schema: _, ...config } = value;
    return found(config);
  }
  return null;
}

function parsePrettierFile(name: string, text: string): unknown {
  if (name === "package.json" || name.endsWith(".json"))
    return JSON.parse(text);
  if (name.endsWith(".json5")) return JSON5.parse(text);
  if (name.endsWith(".toml")) return parseToml(text);
  // package.yaml, .prettierrc, .yml and .yaml: prettier reads an extensionless .prettierrc as YAML, which also takes JSON.
  return parseYaml(text);
}

/** Prettier's `mergeOverrides`: each matching entry's options are assigned in order over the base. */
function applyOverrides(
  found: Found,
  path: string,
  unsupported: string[],
): Record<string, unknown> {
  const { overrides, ...options } = found.config;
  if (overrides === undefined) return options;
  if (!Array.isArray(overrides)) {
    unsupported.push(
      `${found.path}: "overrides" must be a list; it is ignored`,
    );
    return options;
  }
  const configDir = dirname(found.path);
  const relative = configDir === "" ? path : path.slice(configDir.length + 1);
  for (const [i, override] of overrides.entries()) {
    const where = `${found.path}: overrides[${i}]`;
    if (
      !isObject(override) ||
      !isGlobs(override.files) ||
      !isObject(override.options)
    ) {
      unsupported.push(`${where} needs "files" and "options"; it is ignored`);
      continue;
    }
    const excludeFiles = override.excludeFiles ?? [];
    if (!isGlobs(excludeFiles)) {
      unsupported.push(`${where} has an invalid "excludeFiles"; it is ignored`);
      continue;
    }
    try {
      if (matchesGlobs(relative, override.files, excludeFiles))
        Object.assign(options, override.options);
    } catch (error) {
      unsupported.push(`${where}: ${message(error)}; it is ignored`);
    }
  }
  return options;
}

/** Prettier's `pathMatchesGlobs`: patterns without a slash match the basename, the rest the whole relative path. */
function matchesGlobs(
  path: string,
  files: string | string[],
  excludeFiles: string | string[],
): boolean {
  const patterns = typeof files === "string" ? [files] : files;
  const match = (globs: string[], basename: boolean) =>
    globs.length > 0 &&
    picomatch(globs, { ignore: excludeFiles, basename, dot: true })(path);
  return (
    match(
      patterns.filter((p) => !p.includes("/")),
      true,
    ) ||
    match(
      patterns.filter((p) => p.includes("/")),
      false,
    )
  );
}

const ruffFiles = [".ruff.toml", "ruff.toml", "pyproject.toml"];

/** Ruff's `settings_toml`: `.ruff.toml`, then `ruff.toml`, then a `pyproject.toml` that has a `[tool.ruff]` table. */
async function ruffIn(
  dir: string,
  read: (name: string) => Promise<string | undefined>,
): Promise<Found | null> {
  const texts = await Promise.all(ruffFiles.map(read));
  for (const [i, name] of ruffFiles.entries()) {
    const text = texts[i];
    if (text === undefined) continue;
    const path = join(dir, name);
    let table: unknown;
    try {
      table = parseToml(text);
    } catch (error) {
      return {
        path,
        config: {},
        unsupported: [`${path}: could not be parsed (${message(error)})`],
      };
    }
    if (name === "pyproject.toml") {
      const tool = isObject(table) ? table.tool : undefined;
      table = isObject(tool) ? tool.ruff : undefined;
      if (table === undefined) continue;
    }
    if (!isObject(table))
      return {
        path,
        config: {},
        unsupported: [`${path}: the ruff settings must be a table`],
      };
    const unsupported: string[] = [];
    if (table.extend !== undefined)
      unsupported.push(
        `${path}: "extend" cannot be followed here, so only the settings in this file are used`,
      );
    const config: Record<string, unknown> = {};
    for (const key of ["line-length", "indent-width"])
      if (table[key] !== undefined) config[key] = table[key];
    const format = table.format;
    if (isObject(format))
      for (const [key, value] of Object.entries(format))
        config[`format.${key}`] = value;
    else if (format !== undefined)
      unsupported.push(`${path}: "format" must be a table; it is ignored`);
    return { path, config, unsupported };
  }
  return null;
}

type Rule = (value: unknown) => boolean;

const int =
  (min: number, max: number): Rule =>
  (v) =>
    Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const bool: Rule = (v) => typeof v === "boolean";
const oneOf =
  (...choices: string[]): Rule =>
  (v) =>
    typeof v === "string" && choices.includes(v);

// Types and choices from prettier 3.9.9's getSupportInfo().
const prettierRules: Record<keyof PrettierOptions, Rule> = {
  printWidth: int(0, Number.MAX_SAFE_INTEGER),
  tabWidth: int(0, Number.MAX_SAFE_INTEGER),
  useTabs: bool,
  semi: bool,
  singleQuote: bool,
  jsxSingleQuote: bool,
  quoteProps: oneOf("as-needed", "consistent", "preserve"),
  trailingComma: oneOf("all", "es5", "none"),
  bracketSpacing: bool,
  bracketSameLine: bool,
  arrowParens: oneOf("always", "avoid"),
  endOfLine: oneOf("lf", "crlf", "cr", "auto"),
  objectWrap: oneOf("preserve", "collapse"),
};

// Ranges and choices from the errors ruff 0.16.8 gives for out-of-range values.
const ruffRules: Record<keyof RuffOptions, Rule> = {
  "line-length": int(1, 65535),
  "indent-width": int(1, 255),
  "format.quote-style": oneOf("double", "single", "preserve"),
  "format.indent-style": oneOf("space", "tab"),
  "format.skip-magic-trailing-comma": bool,
  "format.line-ending": oneOf("auto", "lf", "cr-lf", "native"),
};

function validate<O extends object>(
  config: Record<string, unknown>,
  rules: Record<keyof O, Rule>,
  path: string,
  unsupported: string[],
): Partial<O> {
  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const rule = (rules as Record<string, Rule | undefined>)[key];
    if (!rule) unsupported.push(`${path}: "${key}" is not applied`);
    else if (!rule(value))
      unsupported.push(
        `${path}: "${key}" has an invalid value ${JSON.stringify(value)}; it is ignored`,
      );
    else options[key] = value;
  }
  return options as Partial<O>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isGlobs(v: unknown): v is string | string[] {
  return (
    typeof v === "string" ||
    (Array.isArray(v) && v.every((p) => typeof p === "string"))
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function join(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}
