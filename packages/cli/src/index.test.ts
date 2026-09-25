import { schemaVersion } from "@hihyou/engine";
import { expect, test } from "vitest";
import { supportedSchemaVersion } from "./index.js";

test("cli resolves @hihyou/engine through the workspace source condition", () => {
  expect(supportedSchemaVersion).toBe(schemaVersion);
});
