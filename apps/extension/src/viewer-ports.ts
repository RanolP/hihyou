/**
 * The extension's ViewerPorts: AST via background-SW RPC, seen state via
 * extension storage, GitHub I/O via the page's session.
 */

import type { ViewerPorts } from '@hihyou/diff-viewer';
import {
  fetchDiffEntries,
  fetchRawBlob,
  setFileViewed,
} from '@hihyou/github/github-changes';
import { resolveStack } from '@hihyou/github/pr-stack';
import {
  analyzeBlob,
  analyzeFile,
  declHashesBlob,
  structuralDiff,
} from './ast-client';
import { astMessaging } from './ast-rpc';
import { loadSeenState, prKey, saveSeenState } from './seen-store';

export const extensionPorts: ViewerPorts = {
  ast: {
    analyzeFile,
    analyzeBlob,
    declHashesBlob,
    structuralDiff,
    tsHover: (req) => astMessaging.sendMessage('tsHover', req),
  },
  seenStore: {
    load: (pr) => loadSeenState(prKey(pr)),
    save: (pr, state) => saveSeenState(prKey(pr), state),
  },
  setFileViewed,
  fetchRawBlob,
  fetchDiffEntries,
  resolveStack,
};
