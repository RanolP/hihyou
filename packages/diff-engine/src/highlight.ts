/**
 * Shared shiki highlighter on the JavaScript regex engine — no WASM, so it
 * runs in any context (github.com CSP blocks WASM in content scripts).
 */

import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import langCss from '@shikijs/langs/css';
import langHtml from '@shikijs/langs/html';
import langJavascript from '@shikijs/langs/javascript';
import langJson from '@shikijs/langs/json';
import langJsx from '@shikijs/langs/jsx';
import langMarkdown from '@shikijs/langs/markdown';
import langTsx from '@shikijs/langs/tsx';
import langTypescript from '@shikijs/langs/typescript';
import langYaml from '@shikijs/langs/yaml';
import themeDark from '@shikijs/themes/github-dark';
import themeLight from '@shikijs/themes/github-light';

let instance: Promise<HighlighterCore> | null = null;

export function getHighlighter(): Promise<HighlighterCore> {
  instance ??= createHighlighterCore({
    themes: [themeDark, themeLight],
    langs: [
      langTypescript,
      langTsx,
      langJavascript,
      langJsx,
      langJson,
      langCss,
      langHtml,
      langMarkdown,
      langYaml,
    ],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return instance;
}

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
};

export function langForPath(path: string): string | null {
  const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : '';
  return LANG_BY_EXT[ext] ?? null;
}

/** GitHub sets data-color-mode / data-*-theme on <html>. */
export function currentShikiTheme(): string {
  const html = document.documentElement;
  const mode = html.getAttribute('data-color-mode');
  const dark =
    mode === 'dark' ||
    (mode === 'auto' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  return dark ? 'github-dark' : 'github-light';
}
