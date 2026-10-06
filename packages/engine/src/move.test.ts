import { parseTree } from "syntechs/core";
import { match, Side } from "syntechs/diff";
import { expect, test } from "vitest";
import type { CodeFragment } from "./fragments.js";
import { syntechsGrammars } from "./grammars.js";
import { createEngine } from "./host.js";
import { crossFileMoves } from "./move.js";

const moved = `export function checksum(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
`;

const blobs: Record<string, string> = {
  a0: `export const name = "a";\n\n${moved}`,
  a1: `export const name = "a";\n`,
  b0: `export const name = "b";\n`,
  b1: `export const name = "b";\n\n${moved}`,
};

const counterparts = (fragments: CodeFragment[]) =>
  fragments.flatMap((f) =>
    f.kind === "diff"
      ? [...(f.before.moves ?? []), ...(f.after.moves ?? [])].map(
          (m) => m.counterpart.path,
        )
      : [],
  );

// Without the counterpart on both sides a moved function reads as one deletion and one unrelated addition.
test("a function moved from a.ts to b.ts points at the other file on both sides", async () => {
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: [
        { path: "a.ts", before: "a0", after: "a1" },
        { path: "b.ts", before: "b0", after: "b1" },
      ],
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  });
  const files = await (await engine.diffset("pr")).diff();
  const byPath = new Map(files.map((f) => [f.path, f.fragments]));

  expect(counterparts(byPath.get("a.ts") ?? [])).toContain("b.ts");
  expect(counterparts(byPath.get("b.ts") ?? [])).toContain("a.ts");
});

// vitejs/vite#21626: the case block shares more nodes with the extracted function's body than with its own
// remainder, and pairing it there showed the whole `case` body as moved out and re-added, untouched lines included.
test("a loop extracted out of a case block moves alone, leaving the case's other statements unchanged", async () => {
  const prelude = `async function onMessage(p: Payload) {
  switch (p.type) {
    case "reload": {
      const { by } = p;
      const urls = by ? entries(byFile(slash(by))) : all();
      if (!urls.size) break;
      log.debug("reload");
      await notify("before", p);
`;
  const blobs: Record<string, string> = {
    b: `${prelude}      modules.clear();
      for (const url of urls) {
        if (closed()) break;
        try {
          await load(url);
        } catch (err) {
          if (closed()) break;
          if (err.code !== OUTDATED) {
            log.error(\`reload failed\\n\${err.message}\\n\${err.stack}\`);
          }
        }
      }
      break;
    }
  }
}
`,
    a: `${prelude}      await reimport(urls);
      break;
    }
  }
}

async function reimport(entrypoints: Set<string>) {
  modules.clear();
  for (const url of entrypoints) {
    if (closed()) break;
    try {
      await load(url);
    } catch (err) {
      if (closed()) break;
      if (err.code !== OUTDATED) {
        client?.log.error(\`reload failed\\n\${err.message}\\n\${err.stack}\`);
      }
    }
  }
}
`,
  };
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: [{ path: "h.ts", before: "b", after: "a" }],
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  });
  const [file] = await (await engine.diffset("pr")).diff();
  const fragments = file?.fragments ?? [];
  const shown = fragments.flatMap((f) =>
    f.kind === "diff"
      ? [f.before, f.after].flatMap((s) => s.spans.map((x) => x.text))
      : [],
  );

  expect(shown.join("")).not.toContain("log.debug");
  expect(counterparts(fragments)).toContain("h.ts");
});

// The inserted wrapper was reported as one insert spanning the children it now holds, so every matched,
// merely re-indented child read as removed and re-added.
test("a subtree wrapped in a new render-prop callback stays unchanged rather than removed and re-added", async () => {
  const blobs: Record<string, string> = {
    b: `export function Badge({ onOpen }: Props) {
  return (
    <Touchable onPress={onOpen} style={styles.badge}>
      <Gradient
        colors={[palette.violet, "#2eacff"]}
        start={{ x: 0.35, y: 0.5 }}
        style={styles.fill}
      />
      <Label size="s">new</Label>
    </Touchable>
  );
}
`,
    a: `export function Badge({ onOpen }: Props) {
  return (
    <Pressable onPress={onOpen} style={styles.badge}>
      {({ pressed }) => (
        <>
          <Gradient
            colors={[palette.violet, "#2eacff"]}
            start={{ x: 0.35, y: 0.5 }}
            style={styles.fill}
          />
          {pressed && <Shade style={styles.shade} />}
          <Label size="s">new</Label>
        </>
      )}
    </Pressable>
  );
}
`,
  };
  const diff = async (before: string, after: string) => {
    const engine = createEngine({
      grammars: syntechsGrammars(),
      resolveDiffset: (data: "pr") => ({
        id: data,
        changes: [{ path: "badge.tsx", before, after }],
      }),
      readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
    });
    const [file] = await (await engine.diffset("pr")).diff();
    const fragments = file?.fragments ?? [];
    return {
      shown: fragments
        .flatMap((f) =>
          f.kind === "diff"
            ? [f.before, f.after].flatMap((s) => s.spans.map((x) => x.text))
            : [],
        )
        .join(""),
      moves: counterparts(fragments),
    };
  };

  // Wrapping and the reverse, unwrapping, take the same path.
  for (const [before, after] of [
    ["b", "a"],
    ["a", "b"],
  ] as const) {
    const { shown, moves } = await diff(before, after);
    expect(shown).not.toContain("Gradient");
    expect(shown).not.toContain("Label");
    expect(shown).toContain("Pressable");
    expect(shown).toContain("<Shade");
    expect(moves).toEqual([]);
  }
});

// The whole moved node was emphasized, so a condition edited on the way was lost in the box's uniform highlight.
test("a moved block shows the condition changed inside it", async () => {
  const body = `    notify(listeners, "open");
    log.info("opened", id);
    metrics.count("open", { id, source });
  }
`;
  const blobs: Record<string, string> = {
    b: `function setup(id: string) {
  start(id);
  if (ready && !closed) {
${body}  configure(options);
  register(id, handlers);
  finish(id);
}
`,
    a: `function setup(id: string) {
  start(id);
  configure(options);
  register(id, handlers);
  if (ready && !closed && visible) {
${body}  finish(id);
}
`,
  };
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: [{ path: "setup.ts", before: "b", after: "a" }],
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  });
  const [file] = await (await engine.diffset("pr")).diff();
  const moved = (file?.fragments ?? []).flatMap((f) =>
    f.kind === "diff" ? [f.before, f.after].filter((s) => s.moves) : [],
  );
  const emphasized = moved
    .flatMap((s) => s.spans.filter((x) => x.changed).map((x) => x.text))
    .join("");

  expect(moved.length).toBeGreaterThan(0);
  expect(emphasized).toContain("visible");
  expect(emphasized).not.toContain("notify");
  expect(emphasized).not.toContain("ready");
});

// A false move is worse than none: a declaration whose value was inlined into a differently named one, and a
// parameter list matched to a look-alike in another callback, both read as code that moved when none did.
test("look-alike but different code is not paired as a move", async () => {
  const blobs: Record<string, string> = {
    b: `export function grid(start: number, step: number, count: number, end: number) {
  const width = step * scale;
  const origin = Math.max(start - MARGIN, 0);
  const until = Math.min(start + span + MARGIN, end);
  const first = Math.floor(origin / step);
  const cells = Array.from({ length: count }, (_, offset) => {
    const index = first + offset;
    const remain = end - index * step;
    return { index, width: Math.min(step, remain) * scale };
  }).filter((cell) => cell.width > 0);
  return cells;
}
`,
    a: `export function grid(start: number, step: number, count: number, end: number) {
  const size = TILE / scale;
  const until = Math.min(start + span + MARGIN, end);
  const firstTile = Math.floor(Math.max(start - MARGIN, 0) / size);
  const tiles = Array.from({ length: count }, (_, offset) => {
    const index = firstTile + offset;
    return { index, width: Math.min(size, end - index * size) * scale, uri: toUri(index) };
  }).filter((tile) => tile.width > 0);
  const extra = [[start - MARGIN * 2, start - MARGIN]].flatMap(([from, to]) => {
    const lo = Math.floor(Math.max(from, 0) / size);
    return Array.from({ length: Math.max(to - lo, 0) }, (_, offset) => toUri(lo + offset));
  });
  return { tiles, extra };
}
`,
  };
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: [{ path: "grid.ts", before: "b", after: "a" }],
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  });
  const [file] = await (await engine.diffset("pr")).diff();

  expect(counterparts(file?.fragments ?? [])).toEqual([]);
});

// The old `if (id != null)` paired with the new effect's `else if (id != null)` by shape, and the old effect with
// the new one above it by order, so the edited cleanup read as removed and re-added instead of one inserted clause.
test("a condition extended in place stays an update even when a new sibling block contains a look-alike condition", async () => {
  const blobs: Record<string, string> = {
    b: `export function useSession(id: number | null, offset: number) {
  useEffect(
    () => () => {
      if (id != null) close(id, offset);
    },
    [id, offset],
  );
  return id;
}
`,
    a: `export function useSession(id: number | null, offset: number) {
  const closedRef = useRef<number | null>(null);
  useEffect(() => {
    const sub = events.on("change", (state) => {
      if (state === "active") {
        reload();
      } else if (id != null) {
        closedRef.current = id;
        close(id, offset);
      }
    });
    return () => sub.remove();
  }, [id, offset, reload]);

  useEffect(
    () => () => {
      if (id != null && closedRef.current !== id) close(id, offset);
    },
    [id, offset],
  );
  return id;
}
`,
  };
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: [{ path: "session.ts", before: "b", after: "a" }],
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  });
  const [file] = await (await engine.diffset("pr")).diff();
  const fragments = file?.fragments ?? [];
  const sides = fragments.flatMap((f) =>
    f.kind === "diff" ? [f.before, f.after] : [],
  );
  const emphasized = (needle: string) =>
    sides
      .filter((s) =>
        s.spans
          .map((x) => x.text)
          .join("")
          .includes(needle),
      )
      .flatMap((s) => s.spans.filter((x) => x.changed).map((x) => x.text))
      .join("")
      .replace(/\s+/g, "");

  expect(emphasized("if (id != null) close")).toBe("");
  expect(emphasized("closedRef.current !== id)")).toBe(
    "&&closedRef.current!==id",
  );
  expect(counterparts(fragments)).toEqual([]);
});

// A literal below the top-down height was only ever paired with a same-kind sibling, so `16` becoming `s(16)`
// showed the old `16` removed and the new one added instead of the one call inserted around it.
test("a literal wrapped in a call shows only the call added", async () => {
  const blobs: Record<string, string> = {
    b: `export const styles = {
  box: { padding: 16, gap: 4, width: SIZE },
};
`,
    a: `export const styles = {
  box: { padding: s(16), gap: s(4), width: s(SIZE) },
};
`,
  };
  const changed = async (before: string, after: string) => {
    const engine = createEngine({
      grammars: syntechsGrammars(),
      resolveDiffset: (data: "pr") => ({
        id: data,
        changes: [{ path: "styles.ts", before, after }],
      }),
      readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
    });
    const [file] = await (await engine.diffset("pr")).diff();
    const fragments = file?.fragments ?? [];
    const emphasized = (side: "before" | "after") =>
      fragments
        .flatMap((f) =>
          f.kind === "diff"
            ? f[side].spans.filter((x) => x.changed).map((x) => x.text)
            : [],
        )
        .join("");
    return {
      before: emphasized("before"),
      after: emphasized("after"),
      moves: counterparts(fragments),
    };
  };

  // Wrapping and the reverse, unwrapping, take the same path.
  expect(await changed("b", "a")).toEqual({
    before: "",
    after: "s()s()s()",
    moves: [],
  });
  expect(await changed("a", "b")).toEqual({
    before: "s()s()s()",
    after: "",
    moves: [],
  });
});

const diffOne = async (path: string, before: string, after: string) => {
  const blobs: Record<string, string> = { b: before, a: after };
  const engine = createEngine({
    // These inputs are hand-written unformatted, and the moves they pin are of the code as written.
    grammars: syntechsGrammars({ format: { typescript: false } }),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: [{ path, before: "b", after: "a" }],
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  });
  const [file] = await (await engine.diffset("pr")).diff();
  return (file?.fragments ?? []).flatMap((f) => (f.kind === "diff" ? [f] : []));
};

const sideLines = (s: { spans: { text: string }[] }) =>
  s.spans
    .map((p) => p.text)
    .join("")
    .split("\n")
    .slice(0, -1);

// A move tagged its whole hunk side, so the call an expression was inlined into, unchanged but for its argument,
// read as moved along with it, and nothing told the moved expression apart from the code around it.
test("an expression inlined into a call argument shows only that expression as moved, not the enclosing statement", async () => {
  const diffs = await diffOne(
    "exit.ts",
    `function exit(service: Service, id: number, offset: number) {
  const done = service.exitOrphan(id, offset)
  // track the exit so the next screen waits for it
  // before it starts a session of its own
  // which would otherwise race this one
  service.track(done)
}
`,
    `function exit(service: Service, id: number, offset: number) {
  // track the exit so the next screen waits for it
  // before it starts a session of its own
  // which would otherwise race this one
  service.track(
    service.exitOrphan(id, offset),
  )
}
`,
  );
  const moved = diffs.flatMap((d) =>
    (d.after.moves ?? []).map((m) => ({
      lines: sideLines(d.after).length,
      text: sideLines(d.after)
        .slice(m.first - d.after.startLine, m.last - d.after.startLine + 1)
        .map((l) => l.trim()),
    })),
  );
  expect(moved).toEqual([{ lines: 3, text: ["service.exitOrphan(id, offset),"] }]);
});

// A comment pairs only through its parent's recovery, so when a block body became an expression body the
// comments it held, word for word the same, read as removed and re-added.
test("identical comments under a re-parented block stay unchanged", async () => {
  const diffs = await diffOne(
    "source.ts",
    `export const query = useQuery({
  queryFn: () => {
    const run = fetchSource(id)
    // the player waits on pending sessions only
    // so register this one before it starts
    tracker.track(run)
    return run
  },
  staleTime: Infinity,
})
`,
    `export const query = useQuery({
  queryFn: () =>
    // the player waits on pending sessions only
    // so register this one before it starts
    tracker.track(fetchSource(id)),
  staleTime: Infinity,
})
`,
  );
  const shown = diffs.flatMap((d) => [...sideLines(d.before), ...sideLines(d.after)]);
  expect(shown.length).toBeGreaterThan(0);
  expect(shown.filter((l) => l.includes("//"))).toEqual([]);
});

// Swapping a ternary's branches in place matched each branch to its old self and boxed the one line as moved,
// though both halves sat side by side in one hunk: the box claimed a move the reader could not see.
test("a move within one hunk, a ternary branch swap, is not shown as a move", async () => {
  const diffs = await diffOne(
    "start.ts",
    `export const source = {
  uri: track.uri,
  startPosition: Platform.OS === "android" ? Math.max(startMs, 1) : startMs,
  drm: token ? buildDrm(token) : undefined,
}
`,
    `export const source = {
  uri: track.uri,
  startPosition: IS_IOS ? startMs : Math.max(startMs, 1),
  drm: token ? buildDrm(token) : undefined,
}
`,
  );
  expect(diffs).toHaveLength(1);
  expect(diffs.flatMap((d) => [d.before.moves, d.after.moves])).toEqual([undefined, undefined]);
});

const ledgerRest = `export function render(view: View): void {
  view.clear();
  view.draw(rows);
}

export function scale(x: number): number {
  return x * factor;
}
`;
const audit = `export function audit(entries: Entry[]): string[] {
  return entries.filter((e) => !e.signed).map((e) => e.id);
}
`;
const total = `export function total(items: Item[]): number {
  let s = 0;
  for (const i of items) {
    if (i.void) continue;
    s += i.price * i.qty;
  }
  log("total", s);
  return s;
}
`;
const movedSides = async (after: string) =>
  (
    await diffOne(
      "ledger.ts",
      `${total}\n${ledgerRest}`,
      `${ledgerRest}\n${audit}\n${after}`,
    )
  ).flatMap((d) => [d.before, d.after].filter((s) => s.moves));

// RanolP/hihyou#77: with a name tweaked on every line no statement survived whole to seed the bottom-up phase, and
// the new `audit` left two candidates for the moved function, so it read as a whole delete plus a whole insert.
// Every tweak renames a local (`items`, `s`, `i`), so the function equals its new copy once locals are named by
// their uses, and checkClaim keeps the move it would otherwise demote for having no core.
test("a function moved past new code with a name tweaked on every line reads as one move, the tweaks marked", async () => {
  const moved = await movedSides(`export function total(lines: Item[]): number {
  let sum = 0;
  for (const l of lines) {
    if (l.void) continue;
    sum += l.price * l.qty;
  }
  log("total", sum);
  return sum;
}
`);
  const emphasized = moved
    .flatMap((s) => s.spans.filter((x) => x.changed).map((x) => x.text))
    .join("");

  expect(moved.map((s) => sideLines(s).join("\n"))).toEqual([
    expect.stringContaining("total(items"),
    expect.stringContaining("total(lines"),
  ]);
  expect(emphasized).toContain("sum");
  expect(emphasized).not.toContain("price");
});

// Once nothing seeds a moved function, pairing by shape would show a deleted function and an unrelated new one
// of the same shape as one function that moved.
test("a deleted function and a new one of the same shape but other content are not paired as a move", async () => {
  const moved = await movedSides(`export function count(keys: Key[]): number {
  let n = 1;
  for (const k of keys) {
    if (k.hidden) break;
    n *= k.weight - k.base;
  }
  warn("count", n);
  return n;
}
`);

  expect(moved).toEqual([]);
});

// Ties were broken by taking the first identical candidate: a helper deleted from one file and pasted into two
// others was claimed as moved into whichever came first.
test("code deleted from one file and pasted verbatim into two others is not paired as a move", async () => {
  const grammar = await syntechsGrammars().forPath("a.ts");
  if (!grammar) throw new Error("no TypeScript grammar");
  const side = (text: string) => Side.of(parseTree(grammar.language, text));
  const files: [string, string][] = [
    [`export const name = "a";\n\n${moved}`, `export const name = "a";\n`],
    [`export const name = "b";\n`, `export const name = "b";\n\n${moved}`],
    [`export const name = "c";\n`, `export const name = "c";\n\n${moved}`],
  ];
  const { edits } = crossFileMoves(
    files.map(([before, after]) => match(side(before), side(after))),
  );

  expect(edits.filter((e) => e.edit.kind === "move")).toEqual([]);
});
