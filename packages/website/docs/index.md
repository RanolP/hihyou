---
layout: home

hero:
  name: syntechs
  text: A parser and formatter in pure TypeScript
  tagline: It runs in the browser as plain JavaScript, with no WASM and no native binary, and formats JavaScript, TypeScript, CSS, JSON, Python and Kotlin with prettier, ruff and ktfmt as the reference.
  actions:
    - theme: brand
      text: See the scorecard
      link: /scorecard
    - theme: alt
      text: GitHub
      link: https://github.com/RanolP/hihyou

features:
  - title: Pure TypeScript
    details: The parser and every formatter are TypeScript compiled to JavaScript. Nothing to download, compile or instantiate before the first format.
  - title: Runs where the code is read
    details: The same modules run in a browser tab and in Node, so a code viewer can format what it shows without a server round trip.
  - title: Measured against the reference
    details: Each language is scored on its reference formatter's own test suite and timed against that formatter and oxfmt, on every commit to main.
---
