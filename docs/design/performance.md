# Performance and parity targets

syntechs replaces external formatters and highlighters at runtime (`docs/design/runtime.md`), so it has to prove two things against them: that its output matches, and that it is fast enough to run in a browser page. Both must be reached in TypeScript alone.

## Formatter

"we shall have parity matrix as oxfmt has before. also our goal is 5x slower than oxfmt, faster than prettier."

- **Parity** is tracked like oxc's `tasks/prettier_conformance`: a committed per-language snapshot scoring the formatter on the reference tools' own fixtures, with compatibility N/M and each failing fixture's match percentage. References are prettier's `tests/format` for JSON, CSS, JavaScript, TypeScript and TSX, ruff's formatter fixtures for Python, and ktfmt for Kotlin. The matrix lives in `packages/syntechs/conformance/README.md`.
- **Speed** is parse plus format, measured by the folder-level bench (`packages/syntechs/src/fmt/bench.node.ts`). The target is at most 5x the time of the native reference (oxfmt for JS, TS, JSON and CSS; ruff for Python) and faster than prettier. `docs/research/perf-phases.md` splits where that time goes.

## HTML highlighting backend

The planned `html` backend must match shiki per character and run at least 3x faster than warm shiki's faster engine. `docs/research/html-backend.md` records the target and its fixed constraints.

## Measured: Doc item count is not the lever

Reducing how many Doc items the printer walks does not make formatting faster; per-token work dominates. An experiment merged adjacent `TOKEN`/`TEXT` items into one run item in a post-build pass, keeping output and anchors byte-identical. It cut printer and `fits` item pops by 36-55%, yet format got slower in every language (TypeScript 550 to 625 ms, JSON 128 to 162 ms): the pass cost 15-100 ms while the printer saved at most about 5%. A build with the new printer but without the pass ran at the old speed. The printer's cost is per-token work (placement records, string building, `trimLineEnd` in `packages/syntechs/src/fmt/stream.ts`), not stepping between items. Together with the allocation measurement in `docs/research/perf-phases.md` ("Doc size and allocations", which caps allocation removal at about 10-20% of format time), this is why the formatter emits straight into the linear stream rather than building and shrinking a Doc.

A Doc-size or item-count reduction is worth trying again only if it happens at build time with no extra pass. The levers left are per-token placement records, rule dispatch during layout, the parser, and cold JIT.
