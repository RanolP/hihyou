/**
 * Moved-code detection (pure): declarations whose normalized-token hash
 * disappears from one file's old side and reappears on a file's new side
 * are the same code, moved.
 */

export interface DeclHash {
  name: string;
  kind: string;
  /** 1-based inclusive blob line range. */
  start: number;
  end: number;
  hash: string;
  /** Normalized token length — small decls make noisy matches. */
  size: number;
}

export interface MoveBlock {
  hash: string;
  name: string;
  fromPath: string;
  fromStart: number;
  fromEnd: number;
  toPath: string;
  toStart: number;
  toEnd: number;
}

const MIN_SIZE = 40;

export function matchMoves(
  oldSides: Record<string, DeclHash[]>,
  newSides: Record<string, DeclHash[]>,
  minSize = MIN_SIZE,
): MoveBlock[] {
  const hashesIn = (decls: DeclHash[] | undefined) =>
    new Set((decls ?? []).map((d) => d.hash));
  // Disappeared: in a file's old side, absent from that file's new side.
  const disappeared: { path: string; decl: DeclHash }[] = [];
  for (const [path, decls] of Object.entries(oldSides)) {
    const stillThere = hashesIn(newSides[path]);
    for (const decl of decls) {
      if (decl.size >= minSize && !stillThere.has(decl.hash)) {
        disappeared.push({ path, decl });
      }
    }
  }
  // Appeared: in a file's new side, absent from that file's old side.
  const appeared: { path: string; decl: DeclHash }[] = [];
  for (const [path, decls] of Object.entries(newSides)) {
    const wasThere = hashesIn(oldSides[path]);
    for (const decl of decls) {
      if (decl.size >= minSize && !wasThere.has(decl.hash)) {
        appeared.push({ path, decl });
      }
    }
  }
  const byHash = new Map<string, { path: string; decl: DeclHash }[]>();
  for (const a of appeared) {
    (byHash.get(a.decl.hash) ?? byHash.set(a.decl.hash, []).get(a.decl.hash)!).push(a);
  }
  const moves: MoveBlock[] = [];
  for (const { path, decl } of disappeared) {
    const targets = byHash.get(decl.hash);
    const target = targets?.shift();
    if (!target) continue;
    moves.push({
      hash: decl.hash,
      name: decl.name || target.decl.name,
      fromPath: path,
      fromStart: decl.start,
      fromEnd: decl.end,
      toPath: target.path,
      toStart: target.decl.start,
      toEnd: target.decl.end,
    });
  }
  return moves;
}
