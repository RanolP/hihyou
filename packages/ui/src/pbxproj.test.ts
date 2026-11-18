import type { FileDiff } from "@hihyou/engine";
import { expect, test } from "vitest";
import { pbxprojLabels } from "./pbxproj.js";

test("a FileDiff summary exposes the Summary and Source toggle with every section heading", () => {
  const file: FileDiff = {
    path: "App.xcodeproj/project.pbxproj",
    fragments: [],
    pbxproj: { files: [], packages: [], targets: [], settings: [], noise: [] },
  };

  expect(file.pbxproj).toBeDefined();
  expect(pbxprojLabels.views).toEqual(["Summary", "Source"]);
  expect(pbxprojLabels.sections).toEqual([
    "Files",
    "Packages",
    "Targets",
    "Build settings",
    "Noise",
  ]);
});
