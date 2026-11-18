import { expect, test } from "vitest";
import { createEngine } from "./host.js";
import { diffPbxproj, parsePbxproj } from "./pbxproj.js";

const id = {
  project: "000000000000000000000001",
  mainGroup: "000000000000000000000002",
  target: "000000000000000000000003",
  sources: "000000000000000000000004",
  pods: "000000000000000000000005",
  configurations: "000000000000000000000006",
  debug: "000000000000000000000007",
  release: "000000000000000000000008",
  buildFile: "000000000000000000000009",
  file: "00000000000000000000000A",
  package: "00000000000000000000000B",
  product: "00000000000000000000000C",
  group: "00000000000000000000000D",
} as const;

const project = (after: boolean) => `// !$*UTF8*$!
{
  archiveVersion = 1;
  objectVersion = 60;
  objects = {
    ${id.project} = {
      isa = PBXProject;
      buildConfigurationList = ${id.configurations};
      mainGroup = ${id.mainGroup};
      targets = (${id.target});
      packageReferences = (${after ? id.package : ""});
    };
    ${id.mainGroup} = { isa = PBXGroup; children = (${id.group}); sourceTree = "<group>"; };
    ${id.group} = { isa = PBXGroup; children = (${after ? id.file : ""}); path = Braze; sourceTree = "<group>"; };
    ${id.target} = {
      isa = PBXNativeTarget;
      name = App;
      buildConfigurationList = ${id.configurations};
      buildPhases = (${id.sources}, ${after ? "" : id.pods});
      packageProductDependencies = (${after ? id.product : ""});
    };
    ${id.sources} = { isa = PBXSourcesBuildPhase; files = (${after ? id.buildFile : ""}); };
    ${after ? "" : `${id.pods} = { isa = PBXShellScriptBuildPhase; name = "[CP] Check Pods Manifest.lock"; files = (); shellScript = "echo pods"; };`}
    ${id.configurations} = {
      isa = XCConfigurationList;
      buildConfigurations = (${id.debug}, ${id.release});
    };
    ${id.debug} = {
      isa = XCBuildConfiguration;
      name = Debug;
      buildSettings = {
        MARKETING_VERSION = ${after ? "1.1" : "1.0"};
        OTHER_CFLAGS = ${after ? "(a, b)" : '"a b"'};
      };
    };
    ${id.release} = {
      isa = XCBuildConfiguration;
      name = Release;
      buildSettings = {
        MARKETING_VERSION = ${after ? "1.1" : "1.0"};
        OTHER_CFLAGS = ${after ? "(a, b)" : '"a b"'};
      };
    };
    ${
      after
        ? `${id.buildFile} = { isa = PBXBuildFile; fileRef = ${id.file}; };
    ${id.file} = { isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = Foo.swift; sourceTree = "<group>"; };
    ${id.package} = {
      isa = XCRemoteSwiftPackageReference;
      repositoryURL = "https://github.com/braze-inc/braze-swift-sdk";
      requirement = { kind = upToNextMajorVersion; minimumVersion = 12.0.0; };
    };
    ${id.product} = { isa = XCSwiftPackageProductDependency; package = ${id.package}; productName = BrazeKit; };`
        : ""
    }
  };
  rootObject = ${id.project};
}
`;

test("the OpenStep parser accepts comments, arrays, strings, and data", () => {
  const parsed = parsePbxproj(
    project(false).replace(
      "archiveVersion = 1;",
      "archiveVersion = <01 ab>; /* data */",
    ),
  );

  expect(parsed?.rootObject).toBe(id.project);
  expect(parsed?.objects.get(id.target)?.["isa"]).toBe("PBXNativeTarget");
});

// One logical Xcode change is scattered across IDs; the summary must join it back into reviewer-facing units.
test("an object-graph diff summarizes files, settings, packages, noise, and phases", () => {
  const summary = diffPbxproj(project(false), project(true));

  expect(summary?.files).toEqual([
    {
      kind: "added",
      path: "Braze/Foo.swift",
      target: "App",
      phase: "Compile Sources",
    },
  ]);
  expect(summary?.settings).toEqual([
    {
      target: "App",
      configuration: "Debug",
      key: "MARKETING_VERSION",
      before: "1.0",
      after: "1.1",
    },
    {
      target: "App",
      configuration: "Release",
      key: "MARKETING_VERSION",
      before: "1.0",
      after: "1.1",
    },
  ]);
  expect(summary?.noise).toEqual([
    {
      target: "App",
      configuration: "Debug",
      key: "OTHER_CFLAGS",
      before: "a b",
      after: "a b",
    },
    {
      target: "App",
      configuration: "Release",
      key: "OTHER_CFLAGS",
      before: "a b",
      after: "a b",
    },
  ]);
  expect(summary?.packages).toEqual([
    {
      kind: "added",
      name: "BrazeKit",
      url: "https://github.com/braze-inc/braze-swift-sdk",
      requirement: "upToNextMajorVersion 12.0.0",
    },
  ]);
  expect(summary?.targets).toContainEqual({
    kind: "removed",
    target: "App",
    phase: "[CP] Check Pods Manifest.lock",
  });
});

test("a whole new project reports counts instead of object details", () => {
  expect(diffPbxproj("", project(true))?.addedProject).toEqual({
    targets: 1,
    files: 1,
    settings: 4,
  });
});

test("a malformed project declines the rich summary", () => {
  expect(parsePbxproj("{ objects = {;")).toBeUndefined();
  expect(diffPbxproj(project(false), "not a plist")).toBeUndefined();
});

test("the engine attaches the summary only to project.pbxproj", async () => {
  const blobs: Record<string, string> = {
    before: project(false),
    after: project(true),
  };
  const engine = createEngine({
    grammars: { forPath: async () => undefined },
    resolveDiffset: (request: "change") => ({
      id: request,
      changes: [
        {
          path: "App.xcodeproj/project.pbxproj",
          before: "before",
          after: "after",
        },
        { path: "project.txt", before: "before", after: "after" },
      ],
    }),
    readBlob: (blob) => new TextEncoder().encode(blobs[blob] ?? ""),
  });

  const [pbxproj, text] = await (await engine.diffset("change")).diff();
  expect(pbxproj?.pbxproj?.files[0]?.path).toBe("Braze/Foo.swift");
  expect(text?.pbxproj).toBeUndefined();
});
