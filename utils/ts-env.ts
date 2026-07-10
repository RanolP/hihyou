/**
 * Virtual TypeScript environment (twoslash-style intelligence). Pure over
 * its inputs: lib files + reviewed file text + unpacked dependency types.
 * Runs in the service worker and in node self-checks.
 */

import ts from 'typescript';
import {
  createSystem,
  createVirtualTypeScriptEnvironment,
} from '@typescript/vfs';

export type DepFiles = Record<string, Record<string, string>>;

export const COMPILER_OPTIONS: import('typescript').CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  esModuleInterop: true,
  allowJs: true,
  strict: false,
  skipLibCheck: true,
};

export function buildEnv(
  libFiles: Map<string, string>,
  fileName: string,
  fileText: string,
  deps: DepFiles,
) {
  const fsMap = new Map(libFiles);
  fsMap.set(fileName, fileText);
  for (const [pkg, files] of Object.entries(deps)) {
    for (const [rel, content] of Object.entries(files)) {
      fsMap.set(`/node_modules/${pkg}/${rel}`, content);
    }
  }
  const system = createSystem(fsMap);
  return createVirtualTypeScriptEnvironment(
    system,
    [fileName],
    ts,
    COMPILER_OPTIONS,
  );
}

export function offsetAt(fileText: string, line: number, col: number): number {
  const lines = fileText.split('\n');
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  return offset + col;
}

export function hoverAt(
  env: ReturnType<typeof buildEnv>,
  fileName: string,
  fileText: string,
  line: number,
  col: number,
): string | null {
  const info = env.languageService.getQuickInfoAtPosition(
    fileName,
    offsetAt(fileText, line, col),
  );
  if (!info) return null;
  const text = (info.displayParts ?? []).map((p) => p.text).join('');
  const docs = (info.documentation ?? []).map((p) => p.text).join('');
  return docs ? `${text}\n\n${docs}` : text;
}

/** Bare package names imported by the file (scoped names kept whole). */
export function importedPackages(fileText: string): string[] {
  const out = new Set<string>();
  const re = /(?:from|import)\s*\(?\s*['"]([^'".][^'"]*)['"]/g;
  for (const m of fileText.matchAll(re)) {
    const spec = m[1];
    if (spec.startsWith('.') || spec.startsWith('/')) continue;
    const parts = spec.split('/');
    out.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
  }
  return [...out];
}
