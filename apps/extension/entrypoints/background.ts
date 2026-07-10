import ts from 'typescript';
import { createDefaultMapFromCDN } from '@typescript/vfs';
import { Language, Parser } from 'web-tree-sitter';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { astMessaging } from '@/utils/ast-rpc';
import {
  analyzeTree,
  declHashes,
  grammarForPath,
  structuralDiffTrees,
} from '@hihyou/diff-engine/ast-service';
import {
  importerForPath,
  lockfileImporterDirs,
  resolveLockfileDeps,
} from '@hihyou/diff-engine/pnpm-lock';
import { extractTypesFromTarball } from '@hihyou/diff-engine/tarball';
import {
  COMPILER_OPTIONS,
  buildEnv,
  hoverAt,
  importedPackages,
  type DepFiles,
} from '@hihyou/diff-engine/ts-env';

let parserReady: Promise<void> | null = null;
const languages = new Map<string, Promise<Language | null>>();

// ── Twoslash TS intelligence (M13) ──
let libsPromise: Promise<Map<string, string>> | null = null;
function getLibs(): Promise<Map<string, string>> {
  libsPromise ??= createDefaultMapFromCDN(
    { target: COMPILER_OPTIONS.target },
    ts.version,
    false,
    ts,
  );
  return libsPromise;
}
/** cacheKey (owner/repo@oid) → lockfile text (or null: repo has none). */
const projects = new Map<string, string | null>();
const depTypesCache = new Map<
  string,
  Promise<Record<string, string> | null>
>();
const envCache = new Map<string, ReturnType<typeof buildEnv>>();

function fetchDepTypes(
  name: string,
  version: string,
): Promise<Record<string, string> | null> {
  const key = `${name}@${version}`;
  let result = depTypesCache.get(key);
  if (!result) {
    const base = name.split('/').pop();
    result = fetch(
      `https://registry.npmjs.org/${name}/-/${base}-${version}.tgz`,
    )
      .then(async (res) =>
        res.ok
          ? extractTypesFromTarball(new Uint8Array(await res.arrayBuffer()))
          : null,
      )
      .catch(() => null);
    depTypesCache.set(key, result);
  }
  return result;
}

function loadLanguage(grammar: string): Promise<Language | null> {
  let lang = languages.get(grammar);
  if (!lang) {
    // Dynamic path; WXT's PublicPath union only accepts literals.
    const getURL = browser.runtime.getURL as (path: string) => string;
    lang = Language.load(
      getURL(`/ts-wasm/tree-sitter-${grammar}.wasm`),
    ).catch((err) => {
      console.warn('[hihyou] grammar load failed:', grammar, err);
      return null;
    });
    languages.set(grammar, lang);
  }
  return lang;
}

async function parserFor(path: string): Promise<Parser | null> {
  const grammar = grammarForPath(path);
  if (!grammar) return null;
  parserReady ??= Parser.init({
    locateFile: () => browser.runtime.getURL('/ts-wasm/web-tree-sitter.wasm'),
  });
  await parserReady;
  const lang = await loadLanguage(grammar);
  if (!lang) return null;
  const parser = new Parser();
  parser.setLanguage(lang);
  return parser;
}

export default defineBackground(() => {
  console.log('[hihyou] background ready', { id: browser.runtime.id });

  astMessaging.onMessage('parseFile', async ({ data }) => {
    try {
      const parser = await parserFor(data.path);
      if (!parser) return null;
      const tree = parser.parse(data.text);
      if (!tree) return null;
      const analysis = analyzeTree(tree.rootNode);
      tree.delete();
      parser.delete();
      return analysis;
    } catch (err) {
      console.warn('[hihyou] parseFile failed:', data.path, err);
      return null;
    }
  });

  astMessaging.onMessage('structuralDiff', async ({ data }) => {
    try {
      const parser = await parserFor(data.path);
      if (!parser) return null;
      const oldTree = parser.parse(data.oldText);
      const newTree = parser.parse(data.newText);
      if (!oldTree || !newTree) return null;
      const hunks = structuralDiffTrees(oldTree.rootNode, newTree.rootNode);
      oldTree.delete();
      newTree.delete();
      parser.delete();
      return hunks;
    } catch (err) {
      console.warn('[hihyou] structuralDiff failed:', data.path, err);
      return null;
    }
  });

  astMessaging.onMessage('declHashes', async ({ data }) => {
    try {
      const parser = await parserFor(data.path);
      if (!parser) return null;
      const tree = parser.parse(data.text);
      if (!tree) return null;
      const hashes = declHashes(tree.rootNode);
      tree.delete();
      parser.delete();
      return hashes;
    } catch (err) {
      console.warn('[hihyou] declHashes failed:', data.path, err);
      return null;
    }
  });

  astMessaging.onMessage('tsHover', async ({ data }) => {
    try {
      if (data.lockfileText !== undefined) {
        projects.set(data.cacheKey, data.lockfileText);
      } else if (!projects.has(data.cacheKey)) {
        return 'NEED_PROJECT';
      }
      const lockfileText = projects.get(data.cacheKey) ?? null;
      const envKey = `${data.cacheKey}:${data.fileName}:${data.fileText.length}`;
      let env = envCache.get(envKey);
      if (!env) {
        const deps: DepFiles = {};
        if (lockfileText) {
          const dirs = lockfileImporterDirs(lockfileText);
          const resolved = resolveLockfileDeps(
            lockfileText,
            importerForPath(dirs, data.repoFilePath),
          );
          const wanted = importedPackages(data.fileText)
            .filter((n) => resolved[n])
            .slice(0, 8);
          await Promise.all(
            wanted.map(async (name) => {
              const files = await fetchDepTypes(name, resolved[name]);
              if (files) deps[name] = files;
            }),
          );
        }
        env = buildEnv(await getLibs(), data.fileName, data.fileText, deps);
        envCache.set(envKey, env);
        if (envCache.size > 4) {
          envCache.delete(envCache.keys().next().value!);
        }
      }
      return hoverAt(env, data.fileName, data.fileText, data.line, data.col);
    } catch (err) {
      console.warn('[hihyou] tsHover failed:', err);
      return null;
    }
  });

  // Dev self-reload: the content script forwards `hihyou:reload` from the
  // page; reloading re-reads the unpacked extension from disk.
  browser.runtime.onMessage.addListener((msg: unknown) => {
    if ((msg as { type?: string })?.type === 'hihyou:reload') {
      browser.runtime.reload();
    }
  });
});
