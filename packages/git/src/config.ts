import { type FileSystem, readText } from "./io.js";

export interface ConfigEntry {
  /** Lowercased, as git compares it. */
  section: string;
  /** Case-sensitive, as git compares it; absent for `[core]`-style sections. */
  subsection?: string;
  /** Lowercased. */
  key: string;
  /** A key with no `=` is boolean true, as git reads it. */
  value: string;
}

export interface Remote {
  name: string;
  url: string;
  pushUrl?: string;
}

/** One config file in git's syntax: https://git-scm.com/docs/git-config#_syntax. `include` is not followed. */
export function parseConfig(text: string): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  let section = "";
  let subsection: string | undefined;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = (lines[i] as string).trimStart();
    if (line === "" || line[0] === "#" || line[0] === ";") continue;
    if (line[0] === "[") {
      const m = /^\[\s*([\w.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(line);
      if (!m) continue;
      const name = m[1] as string;
      if (m[2] !== undefined) {
        section = name.toLowerCase();
        subsection = m[2].replace(/\\(.)/g, "$1");
      } else {
        const dot = name.indexOf(".");
        section = (dot < 0 ? name : name.slice(0, dot)).toLowerCase();
        subsection = dot < 0 ? undefined : name.slice(dot + 1).toLowerCase();
      }
      line = line.slice(m[0].length).trimStart();
      if (line === "" || line[0] === "#" || line[0] === ";") continue;
    }
    const key = /^[A-Za-z][\w-]*/.exec(line)?.[0];
    if (!key) continue;
    let rest = line.slice(key.length).trimStart();
    let value = "true";
    if (rest[0] === "=") {
      rest = rest.slice(1);
      while (
        rest.endsWith("\\") &&
        !rest.endsWith("\\\\") &&
        i + 1 < lines.length
      )
        rest = rest.slice(0, -1) + (lines[++i] as string);
      value = parseValue(rest);
    }
    out.push({
      section,
      ...(subsection !== undefined && { subsection }),
      key: key.toLowerCase(),
      value,
    });
  }
  return out;
}

function parseValue(raw: string): string {
  let out = "";
  let quoted = false;
  let pendingSpace = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as string;
    if (!quoted && (c === "#" || c === ";")) break;
    if (!quoted && (c === " " || c === "\t")) {
      if (out !== "") pendingSpace += c;
      continue;
    }
    out += pendingSpace;
    pendingSpace = "";
    if (c === '"') quoted = !quoted;
    else if (c === "\\") {
      const next = raw[++i];
      out += next === "n" ? "\n" : next === "t" ? "\t" : (next ?? "");
    } else out += c;
  }
  return out;
}

export async function readConfig(
  fs: FileSystem,
  path: string,
): Promise<ConfigEntry[]> {
  const text = await readText(fs, path);
  return text === undefined ? [] : parseConfig(text);
}

/** The last value of `section[.subsection].key`, which is the one git uses. */
export function configValue(
  entries: readonly ConfigEntry[],
  name: string,
): string | undefined {
  const first = name.indexOf(".");
  const last = name.lastIndexOf(".");
  const section = name.slice(0, first).toLowerCase();
  const subsection = first === last ? undefined : name.slice(first + 1, last);
  const key = name.slice(last + 1).toLowerCase();
  let found: string | undefined;
  for (const e of entries)
    if (e.section === section && e.subsection === subsection && e.key === key)
      found = e.value;
  return found;
}

export function configBool(
  entries: readonly ConfigEntry[],
  name: string,
  fallback: boolean,
): boolean {
  const v = configValue(entries, name)?.toLowerCase();
  if (v === undefined) return fallback;
  return v === "true" || v === "yes" || v === "on" || v === "1";
}

export function remotesOf(entries: readonly ConfigEntry[]): Remote[] {
  const byName = new Map<string, Remote>();
  for (const e of entries) {
    if (e.section !== "remote" || e.subsection === undefined) continue;
    const remote = byName.get(e.subsection) ?? { name: e.subsection, url: "" };
    byName.set(e.subsection, remote);
    if (e.key === "url" && remote.url === "") remote.url = e.value;
    if (e.key === "pushurl" && remote.pushUrl === undefined)
      remote.pushUrl = e.value;
  }
  return [...byName.values()].filter((r) => r.url !== "");
}
