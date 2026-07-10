/**
 * Typed RPC between the content script and the background service worker
 * (the WASM compute host). Everything crossing is plain serializable data.
 */

import { defineExtensionMessaging } from '@webext-core/messaging';
import type {
  DeclHashInfo,
  FileAnalysis,
  LineRange,
  SemanticHunk,
} from './ast-service';

interface ProtocolMap {
  parseFile(data: { path: string; text: string }): FileAnalysis | null;
  structuralDiff(data: {
    path: string;
    oldText: string;
    newText: string;
  }): SemanticHunk[] | null;
  declHashes(data: { path: string; text: string }): DeclHashInfo[] | null;
  /**
   * Quick info at a position of the file's new blob. Returns the hover
   * text, 'NEED_PROJECT' when the worker wants the lockfile resent, or
   * null. lockfileText: undefined = not sent, null = repo has none.
   */
  tsHover(data: {
    cacheKey: string;
    repoFilePath: string;
    fileName: string;
    fileText: string;
    line: number;
    col: number;
    lockfileText?: string | null;
  }): string | null;
}

export const astMessaging = defineExtensionMessaging<ProtocolMap>();
