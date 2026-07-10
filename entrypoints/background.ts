import { Language, Parser } from 'web-tree-sitter';
import { astMessaging } from '@/utils/ast-rpc';
import {
  analyzeTree,
  grammarForPath,
  structuralDiffTrees,
} from '@/utils/ast-service';

let parserReady: Promise<void> | null = null;
const languages = new Map<string, Promise<Language | null>>();

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

  // Dev self-reload: the content script forwards `hihyou:reload` from the
  // page; reloading re-reads the unpacked extension from disk.
  browser.runtime.onMessage.addListener((msg: unknown) => {
    if ((msg as { type?: string })?.type === 'hihyou:reload') {
      browser.runtime.reload();
    }
  });
});
