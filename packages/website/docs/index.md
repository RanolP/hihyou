---
layout: home

hero:
  name: hihyou
  text: Review the diff, not the pull request or the commit
  tagline: A small extension of a person, by a person, for a person.
  actions:
    - theme: brand
      text: Try It Today
      # A real page load of the raw script, so the userscript manager offers to install it. VitePress leaves a
      # link to a non-page file as written, without the site's base, so the base (/hihyou/) is spelled out.
      link: /hihyou/hihyou.user.js
      target: _self
    - theme: alt
      text: Reviewing Small Diffs Easily
      link: /reviewing-small-diffs-easily
    - theme: alt
      text: GitHub
      link: https://github.com/RanolP/hihyou
---

## Overview

We built syntechs first, so that we own the code reader, the part that matters most in a review. syntechs splits into four parts: a lexer and parser, a formatter, a highlighter, and a diff engine. The formatter, the highlighter and the diff engine are what a reviewer sees, and [The Interface](/the-interface) covers them.

### Acknowledgements

- **tree-sitter**: nine grammars (css, html, javascript, json, kotlin, python, swift, typescript, yaml). The compiler turns their `parser.c` into pure JavaScript.
- **nvim-treesitter**: the `highlights.scm` queries, which the highlighter is generated from.
- **musl libc**: the character classes that grammar scanners call, such as `iswalpha`, are reimplemented to behave exactly like musl's, because web-tree-sitter links against musl and we match its results.
- **Arena allocation**: the tree lives in a bump-allocated arena, a design pattern we follow.
- **Formatter test cases**: prettier 3.9.9 (json, css, js, jsx, typescript, html, yaml), ruff 0.16.8, ktfmt (`--kotlinlang-style`) and swift-format 603.0.0. oxfmt is the output reference and the speed baseline for the prettier-family languages.
- **SVG**: the tests and logos of svgo 3.3.2, and the icons of feather 4.29.2.
- **Benchmark inputs**: bootstrap, normalize.css, animate.css, lodash, jquery, excalidraw, and `typing.py`, `dataclasses.py` and `asyncio/base_events.py` from CPython 3.13.
- **Diff**: GumTree (Falleri et al., 2014) for tree matching, and jsdiff for Myers' line diff.

### Lexer, parser and compiler

The lexer and parser are fast, but they are not the point. The parser is an LR parser in pure TypeScript that runs tree-sitter's parse tables, and it builds the tree into an arena.

The compiler turns tree-sitter's `parser.c` and `grammar.json` into ES modules with no imports, which hold the parse tables and the lexer. It runs only at build time, never during a review.

Supported grammars: css, html, javascript, json, kotlin, python, swift, tsx, typescript and yaml.
