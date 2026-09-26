import { memorySource } from "@hihyou/engine";
import { describe, expect, it } from "vitest";
import { createFormatConfigResolver, createFormatter } from "./index.js";

const formatter = createFormatter();

describe("createFormatter", () => {
  it("every language in the table reaches its syntechs formatter, rather than coming back unsupported", async () => {
    expect(await formatter.format("a.json", '{"a":[1,2]}', "head")).toEqual({
      ok: true,
      text: '{ "a": [1, 2] }\n',
    });
    // jsonc keeps a trailing comma in a broken list; plain json never has one.
    expect(
      await formatter.format("a.jsonc", '{\n"a":1}', "head"),
    ).toMatchObject({ ok: true, text: '{\n  "a": 1,\n}\n' });
    expect(await formatter.format("a.css", "a{color:red}", "head")).toEqual({
      ok: true,
      text: "a {\n  color: red;\n}\n",
    });
  });

  it("the repo config of the file's own side applies, and a reviewer override beats it key by key", async () => {
    const source = memorySource(
      { ".prettierrc": "tabWidth: 4\nbracketSpacing: false\n" },
      {},
    );
    const config = createFormatConfigResolver({
      read: (revision, path) =>
        source.read(revision === "base" ? "base" : "head", path),
    });
    const text = '{\n"a":{"b":1}}';
    expect(
      await createFormatter({ config }).format("x.json", text, "base"),
    ).toMatchObject({ text: '{\n    "a": {"b": 1}\n}\n' });
    expect(
      await createFormatter({ config }).format("x.json", text, "head"),
    ).toMatchObject({ text: '{\n  "a": { "b": 1 }\n}\n' });
    expect(
      await createFormatter({
        config,
        reviewer: { prettier: { tabWidth: 1 } },
      }).format("x.json", text, "base"),
    ).toMatchObject({ text: '{\n "a": {"b": 1}\n}\n' });
  });

  it("broken code comes back as a formatter error instead of a half-formatted file", async () => {
    const result = await formatter.format("broken.json", '{"a": }\n', "head");
    expect(result).toMatchObject({ ok: false, reason: "formatter-error" });
  });

  it("a language with no formatter is reported as unsupported rather than as a formatter error", async () => {
    expect(await formatter.format("main.rs", "fn main(){}\n", "head")).toEqual({
      ok: false,
      reason: "unsupported-language",
      message: "syntechs has no formatter for .rs yet",
    });
  });
});
