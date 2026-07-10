/**
 * Typed RPC between the content script and the background service worker
 * (the WASM compute host). Everything crossing is plain serializable data.
 */

import { defineExtensionMessaging } from '@webext-core/messaging';
import type { FileAnalysis, SemanticHunk } from './ast-service';

interface ProtocolMap {
  parseFile(data: { path: string; text: string }): FileAnalysis | null;
  structuralDiff(data: {
    path: string;
    oldText: string;
    newText: string;
  }): SemanticHunk[] | null;
}

export const astMessaging = defineExtensionMessaging<ProtocolMap>();
