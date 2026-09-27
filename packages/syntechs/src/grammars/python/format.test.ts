import { expect, it } from "vitest";
import { parseTree } from "../../core/index.js";
import { format } from "../../fmt/format.js";
import { python } from "./fmt.js";
import { language } from "./index.js";

const fmt = (text: string) => {
  const r = format(parseTree(language, text), python, {});
  return r.ok ? r.text : `ERR ${r.detail}`;
};

// A `\` line continuation is a named extra in no field, so a spec's `$.children` counted it as the first child and
// handed it to a `.via` custom, which found no expression there and failed the format.
it("reads past a line continuation to a statement's children in no field", () => {
  expect(fmt("def f():\n    return \\\n        x\n")).toBe("def f():\n    return x\n");
  expect(fmt("assert \\\n  x, y\n")).toBe("assert x, y\n");
  expect(fmt("del \\\n  a\n")).toBe("del a\n");
});
