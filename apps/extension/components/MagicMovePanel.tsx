import { onMount } from 'solid-js';
import {
  codeToKeyedTokens,
  createMagicMoveMachine,
} from 'shiki-magic-move/core';
import { MagicMoveRenderer } from 'shiki-magic-move/renderer';
import { fetchRawBlob } from '@hihyou/github/github-changes';
import {
  currentShikiTheme,
  getHighlighter,
  langForPath,
} from '@hihyou/diff-engine/highlight';

const MAX_BYTES = 120_000;
const MAX_LINES = 800;

/**
 * Commit-navigation animation: morph the file's blob at the previous head
 * commit into the blob at the new one, then hand back to the static diff.
 */
export function MagicMovePanel(props: {
  owner: string;
  repo: string;
  path: string;
  fromOid: string;
  toOid: string;
  onDone: () => void;
}) {
  let container!: HTMLDivElement;

  onMount(async () => {
    try {
      const lang = langForPath(props.path);
      if (!lang) return props.onDone();
      const [oldText, newText] = await Promise.all([
        fetchRawBlob(props.owner, props.repo, props.fromOid, props.path),
        fetchRawBlob(props.owner, props.repo, props.toOid, props.path),
      ]);
      if (
        !oldText ||
        !newText ||
        oldText.length > MAX_BYTES ||
        newText.length > MAX_BYTES ||
        oldText.split('\n').length > MAX_LINES ||
        newText.split('\n').length > MAX_LINES
      ) {
        return props.onDone();
      }
      const highlighter = await getHighlighter();
      const theme = currentShikiTheme();
      const machine = createMagicMoveMachine((code) =>
        codeToKeyedTokens(highlighter, code, { lang, theme }, true),
      );
      const renderer = new MagicMoveRenderer(container, {
        duration: 700,
        stagger: 1,
      });
      machine.commit(oldText);
      renderer.replace(machine.current);
      await new Promise((r) => setTimeout(r, 150));
      machine.commit(newText);
      await renderer.render(machine.current);
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.warn('[hihyou] magic-move failed for', props.path, err);
    }
    props.onDone();
  });

  return <div class="hihyou-magic" ref={container} />;
}
