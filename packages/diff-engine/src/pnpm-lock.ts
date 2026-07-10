/**
 * pnpm-lock.yaml resolution (pure): exact dependency versions for the
 * workspace package that owns a reviewed file.
 */

import { parse } from 'yaml';

export type ResolvedDeps = Record<string, string>;

interface LockImporter {
  dependencies?: Record<string, string | { version?: string }>;
  devDependencies?: Record<string, string | { version?: string }>;
}

interface Lockfile {
  importers?: Record<string, LockImporter>;
  dependencies?: LockImporter['dependencies'];
  devDependencies?: LockImporter['devDependencies'];
}

/** Longest importer key that is a directory prefix of the file path. */
export function importerForPath(
  importerDirs: string[],
  filePath: string,
): string {
  let best = '.';
  for (const dir of importerDirs) {
    if (dir === '.') continue;
    if (
      (filePath === dir || filePath.startsWith(dir + '/')) &&
      dir.length > (best === '.' ? 0 : best.length)
    ) {
      best = dir;
    }
  }
  return best;
}

function cleanVersion(raw: string): string | null {
  // "1.2.3(react@18.2.0)" → "1.2.3"; links/catalogs are unresolvable here.
  const m = /^(\d[^(\s]*)/.exec(raw);
  return m ? m[1] : null;
}

export function resolveLockfileDeps(
  lockfileText: string,
  importerDir: string,
): ResolvedDeps {
  const doc = parse(lockfileText) as Lockfile;
  const importer: LockImporter | undefined = doc.importers
    ? (doc.importers[importerDir] ?? doc.importers['.'])
    : doc;
  const out: ResolvedDeps = {};
  for (const section of ['dependencies', 'devDependencies'] as const) {
    for (const [name, info] of Object.entries(importer?.[section] ?? {})) {
      const raw = typeof info === 'string' ? info : (info.version ?? '');
      const version = cleanVersion(raw);
      if (version) out[name] = version;
    }
  }
  return out;
}

export function lockfileImporterDirs(lockfileText: string): string[] {
  const doc = parse(lockfileText) as Lockfile;
  return Object.keys(doc.importers ?? { '.': true });
}
