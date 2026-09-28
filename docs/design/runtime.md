# Runtime constraints: browser-only, pure TypeScript, syntechs only

Three hard constraints shape every package. They rule out whole classes of solutions up front, so a proposal that needs one of them is not an option, whatever it would buy.

## Runs entirely in a browser, with no server

hihyou must run fully in a browser: "we may run on browser without any server". The GUI and a GitHub extension must work as static or in-page code, so a backend such as a `hihyou serve` command can be a convenience at most, never a requirement.

- `@hihyou/engine` and `@hihyou/present` stay free of Node APIs. Node-only code goes behind a `./node` export (for example `@hihyou/engine/node`, which holds the git-CLI source).
- File contents reach a browser shell through a browser-side `Vcs` implementation rather than a server. The planned one reads the GitHub API with proper caching and is shared by the GUI and the extension.

## Pure TypeScript: no wasm, no Rust

Everything is TypeScript. "we're pure ts. no rust possibility is hard-cap." That excludes native addons, napi, Rust-compiled wasm and Rust ports, for performance or any other reason. It also excludes wasm in general: the maintainer ruled out a wasm parser build ("i said no wasm at all"), so the tree-sitter runtime is a pure-TS port (`syntechs/core`) and the formatter is written by hand rather than shipping ruff's wasm build. `docs/research/parser-runtime.md` records the measurements behind that choice.

The rule covers dev tooling too: there is no wasm anywhere in the repo. Correctness oracles that need the reference implementation use the native tools, which only ever run in development and CI: the tree-sitter 0.27 CLI for parser parity (`packages/syntechs/src/core/parity.node.ts`), and the `ruff` and `ktfmt` binaries declared in `mise.toml` for formatter conformance.

When a performance gap against oxfmt or ruff appears, it is closed by profiling and optimizing TypeScript (algorithms, allocation, caching), never by moving work into another language.

## syntechs is the single source of formatting and highlighting

"syntechs가 우리의 근원이다 외부 의존 없이" (syntechs is our source, with no external dependency). Runtime packages format and highlight code only through syntechs. A language syntechs cannot format yet is shown unformatted with an `unsupported` reason; it is never routed to prettier, ruff or any other external formatter.

External tools exist only as baselines: "oxfmt, ruff는 baseline comparison test만을 위해서 존재함" (oxfmt and ruff exist only for baseline comparison tests). oxfmt and prettier are devDependencies of `syntechs` for conformance and benchmarks; ruff and ktfmt are dev tools; shiki is the reference for the planned HTML highlighting backend (`docs/research/html-backend.md`) and may run only in tests and benchmarks.
