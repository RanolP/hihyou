// SVG files, read as HTML: oxfmt takes no `.svg`, and the output syntechs is held to is what it prints for the
// same text named `.html`. The inputs are real files from pinned public repos (fetch-corpus.sh) and the
// hand-written ones under src/grammars/html/svg-corpus.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pkgRoot } from "../../core/corpus.node.js";
import type { Suite } from "./prettier.node.js";

const corpus = join(pkgRoot, "corpus");

/** `dir`'s `.svg` files, recursively, as paths relative to `root`. */
const svgs = (root: string, dir: string) =>
  readdirSync(join(root, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".svg"))
    .map((f) => join(dir, f.replaceAll("\\", "/")))
    .sort();

/**
 * svgo's plugin tests are `<description>\n===\n` (optional), the input, then `@@@` and svgo's own output and
 * parameters: only the input is an SVG someone wrote.
 */
const svgoInput = (text: string) => {
  const body = text.includes("\n===\n") ? text.slice(text.indexOf("\n===\n") + 5) : text;
  const at = body.search(/\n\s*@@@/);
  return `${(at < 0 ? body : body.slice(0, at)).trimEnd()}\n`;
};

/** Every input with an empty expected output, which `referenceSuite` fills in from oxfmt. */
export function svgSuite(): Suite {
  const inputs = [
    ...svgs(corpus, "svgo-3.3.2").map((f) => ({
      fixture: f,
      text: svgoInput(readFileSync(join(corpus, f), "utf8")),
    })),
    ...svgs(corpus, "feather-4.29.2").map((f) => ({
      fixture: f,
      text: readFileSync(join(corpus, f), "utf8"),
    })),
    ...svgs(pkgRoot, "src/grammars/html/svg-corpus").map((f) => ({
      fixture: f,
      text: readFileSync(join(pkgRoot, f), "utf8"),
    })),
  ];
  return {
    cases: inputs.map(({ fixture, text }) => ({
      fixture,
      file: fixture,
      text,
      runs: [
        {
          label: "{}",
          options: {},
          parser: "html",
          expected: "",
          asRecorded: (s: string) => s,
        },
      ],
    })),
    excluded: [],
  };
}
