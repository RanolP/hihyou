import { execFileSync } from "node:child_process";
import {
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";
import type { Plugin } from "vite";
import { defineConfig } from "wxt";
import { browserSafe, conditions } from "./browser-safe.ts";

const browserRoot = fileURLToPath(new URL(".", import.meta.url));
const pkg = JSON.parse(
  readFileSync(path.join(browserRoot, "package.json"), "utf8"),
) as { version: string; author: { name: string; url: string } };

// The Firefox sources zip carries the commit in this file, since an AMO reviewer rebuilds it with no .git.
const commitFile = path.join(browserRoot, "COMMIT");

/** The short commit the build is made from: git's HEAD in this repository, else the sources zip's COMMIT file. */
function buildCommit(): { sha: string; fromGit: boolean } | undefined {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: browserRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    // An archive extracted inside some other checkout must not take that checkout's HEAD.
    if (
      realpathSync(git("rev-parse", "--show-toplevel")) ===
      realpathSync(path.join(browserRoot, "../.."))
    )
      return { sha: git("rev-parse", "--short=8", "HEAD"), fromGit: true };
  } catch {}
  try {
    const sha = readFileSync(commitFile, "utf8").trim();
    if (sha) return { sha, fromGit: false };
  } catch {}
  return undefined;
}

const commit = buildCommit();
// The stores take only dotted integers in `version`, so the commit rides in Chrome's display-only `version_name`;
// WXT drops `version_name` for Firefox, which does not support it.
const versionName = `${pkg.version}-pre${commit ? `+${commit.sha}` : ""}`;
const versionLabel = `v${pkg.version}${commit ? ` (${commit.sha})` : ""}`;

const engineGrammarsPath = fileURLToPath(
  new URL("../engine/src/grammars.ts", import.meta.url),
);

/** Maps each grammar module to the `/grammars-*.js` chunk whose entrypoint registers it. */
function grammarChunkOf(): Record<string, string> {
  const entrypoints = fileURLToPath(new URL("./entrypoints", import.meta.url));
  const chunks: Record<string, string> = {};
  for (const file of readdirSync(entrypoints)) {
    if (!/^grammars-.*\.ts$/.test(file)) continue;
    const source = readFileSync(path.join(entrypoints, file), "utf8");
    for (const [, specifier] of source.matchAll(
      /["'](syntechs\/grammars\/[^"']+)["']\s*:/g,
    ))
      chunks[specifier!] = `/${file.replace(/\.ts$/, ".js")}`;
  }
  return chunks;
}

/** Keeps the extension's app IIFE small by resolving the engine's existing lazy loaders through injected globals. */
function injectedGrammarModules(): Plugin {
  return {
    name: "hihyou:injected-grammar-modules",
    enforce: "pre",
    transform(code, id) {
      if (
        path.normalize(id.split("?", 1)[0] ?? "") !==
        path.normalize(engineGrammarsPath)
      )
        return null;
      let imports = 0;
      const transformed = code.replace(
        /import\((["'])(syntechs\/grammars\/[^"']+)\1\)/g,
        (_match, _quote: string, specifier: string) => {
          imports++;
          return `hihyouGrammarModule(${JSON.stringify(specifier)})`;
        },
      );
      if (imports !== 51)
        throw new Error(
          `expected 51 lazy syntechs grammar imports in ${id}, found ${imports}`,
        );
      const chunks = grammarChunkOf();
      for (const [, specifier] of code.matchAll(
        /import\(["'](syntechs\/grammars\/[^"']+)["']\)/g,
      ))
        if (!chunks[specifier!])
          throw new Error(`no grammars-*.ts entrypoint registers ${specifier}`);
      // A grammar's chunk is injected the first time a file needs it, so opening a pull request waits for the
      // chunks its first file uses rather than for all of them.
      return {
        code: `const hihyouGrammarChunks = ${JSON.stringify(chunks)};\nconst hihyouGrammarModule = async (id) => {\n  if (!globalThis.hihyouGrammarModules?.[id]) await globalThis.hihyouLoadGrammarChunk?.(hihyouGrammarChunks[id]);\n  const module = globalThis.hihyouGrammarModules?.[id];\n  if (!module) throw new Error(\`grammar module \${id} was not injected\`);\n  return module;\n};\n${transformed}`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  manifest: ({ browser }) => ({
    name: "hihyou",
    description:
      "Review GitHub pull requests with hihyou's syntax-aware diff, in place of the Files changed tab.",
    homepage_url: "https://github.com/RanolP/hihyou",
    version_name: versionName,
    // Chrome and its Web Store ignore `author` (the store shows the publisher account), so only Firefox gets the
    // author, which AMO and about:addons show from `developer`.
    ...(browser === "firefox"
      ? { author: pkg.author.name, developer: pkg.author }
      : {}),
    permissions: ["scripting", "storage"],
    action: {
      default_title: "hihyou",
      default_icon: {
        16: "icon-16.png",
        32: "icon-32.png",
        48: "icon-48.png",
        96: "icon-96.png",
        128: "icon-128.png",
      },
    },
    host_permissions: [
      "https://github.com/*",
      "https://api.github.com/*",
      "https://patch-diff.githubusercontent.com/*",
      "https://raw.githubusercontent.com/*",
    ],
    browser_specific_settings: {
      gecko: {
        id: "hihyou@ranolp.github.io",
        ...(browser === "firefox"
          ? {
              data_collection_permissions: { required: ["none"] },
              strict_min_version: "140.0",
            }
          : {}),
      },
    },
  }),
  zip: {
    sourcesRoot: path.resolve(process.cwd(), "../.."),
    includeSources: [
      "LICENSE",
      "mise.toml",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig*.json",
      "packages/browser/**",
      "packages/engine/**",
      "packages/github/**",
      "packages/syntechs/**",
      "packages/ui/**",
    ],
    excludeSources: [
      "**/.output/**",
      "**/.wxt/**",
      "**/dist/**",
      "**/fixture/**",
      "**/fixtures/**",
      "**/test/**",
      "**/tests/**",
      "**/corpus/**",
      "**/conformance/**",
      "**/*.tsbuildinfo",
      "packages/syntechs/grammars/.cache/**",
      // syntechs' postinstall generates these from the grammar packages, and AMO takes no machine-generated source.
      "packages/syntechs/src/grammars/*/bundle.js",
      "packages/syntechs/src/grammars/*/*.gen.ts",
      "packages/website/docs/**",
    ],
  },
  hooks: {
    // Only a build from git writes the file, and removes it again; a rebuild from the sources zip keeps its own.
    "zip:sources:start": () => {
      if (commit?.fromGit) writeFileSync(commitFile, `${commit.sha}\n`);
    },
    "zip:sources:done": () => {
      if (commit?.fromGit) rmSync(commitFile, { force: true });
    },
  },
  vite: () => ({
    define: { __HIHYOU_VERSION__: JSON.stringify(versionLabel) },
    resolve: { conditions },
    // WXT imports each entrypoint in Node to read its definition, with every dependency external. A workspace
    // package would then load its tsc output, which has no .js for a .tsx module (jsx is preserved), so the
    // workspace packages are bundled from source there too.
    environments: {
      inline: { resolve: { noExternal: [/^@hihyou\//], conditions } },
    },
    plugins: [injectedGrammarModules(), browserSafe(), solid()],
  }),
});
