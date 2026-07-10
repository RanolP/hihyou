/**
 * Live demo island: the real DiffViewer over a captured ChangesPayload
 * (wxt-dev/wxt#2464), with fixture-backed ports — no GitHub, no extension.
 */

import {
  DiffViewer,
  memorySeenStore,
  seededAstClient,
  type ViewerData,
  type ViewerPorts,
} from '@hihyou/diff-viewer';
import '@hihyou/diff-viewer/diff-viewer.css';
import type { ChangesPayload } from '@hihyou/github/github-changes';
import fixture from '../fixtures/changes-payload.json';

const payload = fixture as unknown as ChangesPayload;

const data: ViewerData = {
  pr: { owner: 'wxt-dev', repo: 'wxt', number: 2464, view: 'changes' },
  payload,
};

const ports: ViewerPorts = {
  ast: seededAstClient(),
  seenStore: memorySeenStore(),
  setFileViewed: async () => true,
  fetchRawBlob: async () => null,
  fetchDiffEntries: async () => [],
  resolveStack: async () => [],
};

export function DiffDemo() {
  return (
    <div class="hihyou-root demo-root">
      <DiffViewer
        data={() => data}
        prev={() => null}
        native={() => false}
        ports={ports}
        onToggleNative={() => {}}
        onNavigate={() => {}}
      />
    </div>
  );
}
