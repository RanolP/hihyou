// TextMate theme resolution as vscode-textmate does it: each scope of a stack, outermost first, takes the
// rules whose last selector part is the longest dot-prefix of that scope and whose parent parts match the
// scopes above it in order; a scope no rule matches inherits its parent's style.

export interface ThemeRule {
  scope?: string | string[];
  settings: { foreground?: string; fontStyle?: string };
}

/** A VS Code / shiki theme JSON, `include`s already followed by the caller. */
export interface Theme {
  colors?: Record<string, string>;
  tokenColors?: ThemeRule[];
  /** shiki's spelling of `tokenColors`. */
  settings?: ThemeRule[];
}

export interface Style {
  foreground?: string;
  fontStyle?: string;
}

export interface CompiledTheme {
  /** The style a space-separated scope stack resolves to; `{}` when nothing matches. */
  style(stack: string): Style;
}

interface Rule {
  /** Parent selector parts, innermost first. */
  parents: string[];
  index: number;
  style: Style;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  rules: Rule[];
}

const node = (): TrieNode => ({ children: new Map(), rules: [] });

/** Whether `scope` is `selector` or a dot-extension of it. */
const prefixMatch = (scope: string, selector: string) =>
  scope === selector ||
  (scope.startsWith(selector) && scope.charCodeAt(selector.length) === 46);

export function compileTheme(theme: Theme): CompiledTheme {
  const root = node();
  let index = 0;
  const defaults: Style = {};
  for (const rule of theme.tokenColors ?? theme.settings ?? []) {
    const settings = rule.settings ?? {};
    const style: Style = {};
    if (settings.foreground) style.foreground = settings.foreground.toLowerCase();
    if (settings.fontStyle !== undefined) style.fontStyle = settings.fontStyle;
    const scopes =
      rule.scope === undefined
        ? [""]
        : Array.isArray(rule.scope)
          ? rule.scope
          : rule.scope.split(",");
    for (const raw of scopes) {
      const parts = raw.trim().split(/\s+/).filter((p) => p !== "" && p !== ">");
      const last = parts.pop();
      if (last === undefined) {
        Object.assign(defaults, style);
        continue;
      }
      let at = root;
      for (const seg of last.split(".")) {
        let next = at.children.get(seg);
        if (!next) at.children.set(seg, (next = node()));
        at = next;
      }
      at.rules.push({ parents: parts.reverse(), index: index++, style });
    }
  }

  /** Rules whose last part prefixes `scope`, each with that part's segment count. */
  const candidates = (scope: string): [Rule, number][] => {
    let at = root;
    const out: [Rule, number][] = [];
    let depth = 0;
    for (const seg of scope.split(".")) {
      const next = at.children.get(seg);
      if (!next) break;
      at = next;
      depth++;
      for (const r of at.rules) out.push([r, depth]);
    }
    return out;
  };

  const parentsMatch = (parents: string[], above: string[]): boolean => {
    let i = above.length - 1;
    for (const p of parents) {
      while (i >= 0 && !prefixMatch(above[i] as string, p)) i--;
      if (i < 0) return false;
      i--;
    }
    return true;
  };

  const cache = new Map<string, Style>();
  return {
    style(stack) {
      const known = cache.get(stack);
      if (known) return known;
      const scopes = stack === "" ? [] : stack.split(" ");
      let fg = defaults.foreground;
      let font = defaults.fontStyle;
      for (let i = 0; i < scopes.length; i++) {
        let pick: Rule | undefined;
        let pickDepth = 0;
        for (const [r, depth] of candidates(scopes[i] as string)) {
          if (!parentsMatch(r.parents, scopes.slice(0, i))) continue;
          // A longer scope match wins, then more parent parts, then the later rule.
          if (
            !pick ||
            depth > pickDepth ||
            (depth === pickDepth &&
              (r.parents.length > pick.parents.length ||
                (r.parents.length === pick.parents.length &&
                  r.index > pick.index)))
          ) {
            pick = r;
            pickDepth = depth;
          }
        }
        if (pick?.style.foreground !== undefined) fg = pick.style.foreground;
        if (pick?.style.fontStyle !== undefined) font = pick.style.fontStyle;
      }
      const out: Style = {};
      if (fg !== undefined) out.foreground = fg;
      if (font !== undefined) out.fontStyle = font;
      cache.set(stack, out);
      return out;
    },
  };
}
