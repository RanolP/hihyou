import { memorySource } from "@hihyou/engine";
import { describe, expect, it } from "vitest";
import {
  createFormatConfigResolver,
  mergeOptions,
  prettierDefaults,
} from "./index.js";

function resolver(tree: Record<string, string>) {
  const source = memorySource({}, tree);
  return createFormatConfigResolver({
    read: (_revision, path) => source.read("head", path),
  });
}

describe("prettier config discovery", () => {
  it("a config in the file's own package wins over the repo root's, as prettier's nearest-first search does", async () => {
    const r = resolver({
      ".prettierrc": "semi: false\nprintWidth: 100\n",
      "pkg/.prettierrc.json": '{ "singleQuote": true }',
      "pkg/src/a.ts": "",
    });
    expect(await r.prettier("head", "pkg/src/a.ts")).toEqual({
      options: { singleQuote: true },
      source: "pkg/.prettierrc.json",
      unsupported: [],
    });
  });

  it('reads package.json\'s "prettier" key, and skips a package.json without one to reach the parent config', async () => {
    const r = resolver({
      "package.json": '{ "prettier": { "tabWidth": 4 } }',
      "app/package.json": '{ "name": "app" }',
      "app/a.ts": "",
    });
    expect(await r.prettier("head", "app/a.ts")).toMatchObject({
      options: { tabWidth: 4 },
      source: "package.json",
    });
  });

  it("an overrides entry applies only to files its globs match, relative to the config's directory", async () => {
    const r = resolver({
      "web/.prettierrc": JSON.stringify({
        semi: true,
        overrides: [
          { files: "legacy/**/*.js", options: { semi: false } },
          {
            files: "*.test.ts",
            excludeFiles: "keep.test.ts",
            options: { printWidth: 120 },
          },
        ],
      }),
    });
    expect((await r.prettier("head", "web/legacy/x/a.js")).options).toEqual({
      semi: false,
    });
    expect((await r.prettier("head", "web/src/a.js")).options).toEqual({
      semi: true,
    });
    expect((await r.prettier("head", "web/src/a.test.ts")).options).toEqual({
      semi: true,
      printWidth: 120,
    });
    expect((await r.prettier("head", "web/src/keep.test.ts")).options).toEqual({
      semi: true,
    });
  });

  it("a JS config is reported and stops the search, instead of silently falling back to a parent config", async () => {
    const r = resolver({
      ".prettierrc": "semi: false\n",
      "pkg/prettier.config.mjs": "export default { semi: true };",
      "pkg/a.ts": "",
    });
    const found = await r.prettier("head", "pkg/a.ts");
    expect(found).toMatchObject({
      options: {},
      source: "pkg/prettier.config.mjs",
    });
    expect(found.unsupported).toEqual([
      expect.stringContaining("pkg/prettier.config.mjs"),
    ]);
  });
});

describe("ruff config discovery", () => {
  it("a pyproject.toml without [tool.ruff] is skipped, so the parent ruff config still applies", async () => {
    const r = resolver({
      "ruff.toml": 'line-length = 100\n[format]\nquote-style = "single"\n',
      "svc/pyproject.toml": '[project]\nname = "svc"\n',
      "svc/m.py": "",
    });
    expect(await r.ruff("head", "svc/m.py")).toEqual({
      options: { "line-length": 100, "format.quote-style": "single" },
      source: "ruff.toml",
      unsupported: [],
    });
  });
});

describe("mergeOptions", () => {
  it("a reviewer override beats the repo config only for the keys the reviewer set", () => {
    const merged = mergeOptions(
      prettierDefaults,
      { semi: false, printWidth: 100 },
      { printWidth: 60 },
    );
    expect(merged).toMatchObject({
      semi: false,
      printWidth: 60,
      singleQuote: false,
      tabWidth: 2,
    });
  });
});
