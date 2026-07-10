/**
 * Looks-like-CSS/HTML scoring for untagged template literals (pure).
 */

const CSS_DECL = /^\s*[a-z-]+\s*:\s*[^;{}]+;?\s*$/i;
const CSS_SELECTOR = /^\s*[.#&@a-z][^{]*\{\s*$/i;
const HTML_TAG = /<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i;

export function scoreInjectionLang(lines: string[]): 'css' | 'html' | null {
  const content = lines.filter((l) => l.trim().length > 0);
  if (content.length < 2) return null;
  const cssHits = content.filter(
    (l) => CSS_DECL.test(l) || CSS_SELECTOR.test(l),
  ).length;
  const htmlHits = content.filter((l) => HTML_TAG.test(l)).length;
  if (htmlHits >= Math.max(1, content.length * 0.3) && htmlHits >= cssHits) {
    return 'html';
  }
  if (cssHits >= Math.max(2, content.length * 0.4)) return 'css';
  return null;
}
