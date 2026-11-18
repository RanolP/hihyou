// The change set the UI fixture diffs: a few files between real revisions of this repo, plus synthetic blobs.
// Shared by build.mjs and the engine test that checks every claim the fixture emits.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const move = "packages/engine/fixtures/cross-file-move";
const extract = join(here, "../../engine/fixtures/extract");
/** Blob ids are `<rev>:<path>`, which `git show` reads as is. */
export const changes = [
  {
    path: "packages/engine/src/interdiff.ts",
    before: "e6d26b0:packages/engine/src/interdiff.ts",
    after: "5f48679:packages/engine/src/interdiff.ts",
  },
  {
    path: "src/util.ts",
    before: `e6d26b0^:${move}/before/src/util.ts`,
    after: `e6d26b0^:${move}/after/src/util.ts`,
  },
  {
    path: "src/text.ts",
    before: null,
    after: `e6d26b0^:${move}/after/src/text.ts`,
  },
  {
    path: "packages/engine/src/move.ts",
    oldPath: "packages/engine/src/match/cross-file.ts",
    before: "e6d26b0^:packages/engine/src/match/cross-file.ts",
    after: "e6d26b0:packages/engine/src/move.ts",
  },
  {
    path: "docs/design/review-core.md",
    before: "e6d26b0:docs/design/review-core.md",
    after: "5f48679:docs/design/review-core.md",
  },
  {
    path: "packages/engine/src/doc/fold.ts",
    before: "e6d26b0^:packages/engine/src/doc/fold.ts",
    after: null,
  },
  {
    path: "pnpm-lock.yaml",
    before: "e6d26b0^:pnpm-lock.yaml",
    after: "e6d26b0:pnpm-lock.yaml",
  },
  // Whole units: an added file, a function added whole to a changed file, and a method added to a class
  // beside a local added inside another method, which stays no unit.
  { path: "src/whole/added.ts", before: null, after: "synthetic:added" },
  {
    path: "src/whole/shop.ts",
    before: "synthetic:shop-before",
    after: "synthetic:shop-after",
  },
  {
    path: "src/whole/cart.ts",
    before: "synthetic:cart-before",
    after: "synthetic:cart-after",
  },
  // An extract refactor, RanolP/hihyou#380: code of generate.node.ts went into the new kinds.node.ts.
  {
    path: "packages/syntechs/src/highlight/generate.node.ts",
    before: `file:${extract}/before/generate.node.ts`,
    after: `file:${extract}/after/generate.node.ts`,
  },
  {
    path: "packages/syntechs/src/highlight/kinds.node.ts",
    before: null,
    after: `file:${extract}/after/kinds.node.ts`,
  },
  // A function moved below other code with a name tweaked on every line, RanolP/hihyou#77: one edited move.
  {
    path: "src/moved/ledger.ts",
    before: "synthetic:ledger-before",
    after: "synthetic:ledger-after",
  },
  {
    path: "ios/App.xcodeproj/project.pbxproj",
    before: "synthetic:pbxproj-before",
    after: "synthetic:pbxproj-after",
  },
];

const keep = `export function keep(a: number): number {
  return a * 2;
}
`;
const ledgerTotal = (
  list,
  acc,
  item,
) => `export function total(${list}: Item[]): number {
  let ${acc} = 0;
  for (const ${item} of ${list}) {
    if (${item}.void) continue;
    ${acc} += ${item}.price * ${item}.qty;
  }
  log("total", ${acc});
  return ${acc};
}
`;
const ledgerRest = `export function render(view: View): void {
  view.clear();
  view.draw(rows);
}

export function scale(x: number): number {
  return x * factor;
}
`;
// An Xcode project that gains a Swift file and a Swift package, bumps MARKETING_VERSION, reshapes OTHER_CFLAGS
// without changing it, and drops a CocoaPods phase: the pbxproj summary's sections, synthetic like its engine test.
const pbxId = {
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
};

const pbxproj = (after) => `// !$*UTF8*$!
{
  archiveVersion = 1;
  objectVersion = 60;
  objects = {
    ${pbxId.project} = {
      isa = PBXProject;
      buildConfigurationList = ${pbxId.configurations};
      mainGroup = ${pbxId.mainGroup};
      targets = (${pbxId.target});
      packageReferences = (${after ? pbxId.package : ""});
    };
    ${pbxId.mainGroup} = { isa = PBXGroup; children = (${pbxId.group}); sourceTree = "<group>"; };
    ${pbxId.group} = { isa = PBXGroup; children = (${after ? pbxId.file : ""}); path = Braze; sourceTree = "<group>"; };
    ${pbxId.target} = {
      isa = PBXNativeTarget;
      name = App;
      buildConfigurationList = ${pbxId.configurations};
      buildPhases = (${pbxId.sources}, ${after ? "" : pbxId.pods});
      packageProductDependencies = (${after ? pbxId.product : ""});
    };
    ${pbxId.sources} = { isa = PBXSourcesBuildPhase; files = (${after ? pbxId.buildFile : ""}); };
    ${after ? "" : `${pbxId.pods} = { isa = PBXShellScriptBuildPhase; name = "[CP] Check Pods Manifest.lock"; files = (); shellScript = "echo pods"; };`}
    ${pbxId.configurations} = {
      isa = XCConfigurationList;
      buildConfigurations = (${pbxId.debug}, ${pbxId.release});
    };
    ${pbxId.debug} = {
      isa = XCBuildConfiguration;
      name = Debug;
      buildSettings = {
        MARKETING_VERSION = ${after ? "1.1" : "1.0"};
        OTHER_CFLAGS = ${after ? "(a, b)" : '"a b"'};
      };
    };
    ${pbxId.release} = {
      isa = XCBuildConfiguration;
      name = Release;
      buildSettings = {
        MARKETING_VERSION = ${after ? "1.1" : "1.0"};
        OTHER_CFLAGS = ${after ? "(a, b)" : '"a b"'};
      };
    };
    ${
      after
        ? `${pbxId.buildFile} = { isa = PBXBuildFile; fileRef = ${pbxId.file}; };
    ${pbxId.file} = { isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = Foo.swift; sourceTree = "<group>"; };
    ${pbxId.package} = {
      isa = XCRemoteSwiftPackageReference;
      repositoryURL = "https://github.com/braze-inc/braze-swift-sdk";
      requirement = { kind = upToNextMajorVersion; minimumVersion = 12.0.0; };
    };
    ${pbxId.product} = { isa = XCSwiftPackageProductDependency; package = ${pbxId.package}; productName = BrazeKit; };`
        : ""
    }
  };
  rootObject = ${pbxId.project};
}
`;

/** Synthetic blobs, read by their `synthetic:` id instead of from git. */
const synthetic = {
  "pbxproj-before": pbxproj(false),
  "pbxproj-after": pbxproj(true),
  added: `export function extra(a: number): number {
  return a + 1;
}

export class Shop {
  open = true;
}
`,
  "shop-before": keep,
  "shop-after": `${keep}
export function extra(b: number): number {
  const c = b + 1;
  return c;
}
`,
  "cart-before": `export class Cart {
  total(prices: number[]): number {
    return prices.reduce((a, b) => a + b, 0);
  }
}
`,
  "cart-after": `export class Cart {
  total(prices: number[]): number {
    const sum = prices.reduce((a, b) => a + b, 0);
    return sum;
  }

  clear(): void {
    this.total([]);
  }
}
`,
  "ledger-before": `${ledgerTotal("items", "s", "i")}
${ledgerRest}`,
  "ledger-after": `${ledgerRest}
export function audit(entries: Entry[]): string[] {
  return entries.filter((e) => !e.signed).map((e) => e.id);
}

${ledgerTotal("lines", "sum", "l")}`,
};

/** Reads a blob id of `changes`: `synthetic:<name>`, `file:<path>`, or a `<rev>:<path>` git reads as is. */
export const readBlob = (id) =>
  id.startsWith("synthetic:")
    ? new TextEncoder().encode(synthetic[id.slice("synthetic:".length)])
    : id.startsWith("file:")
      ? new Uint8Array(readFileSync(id.slice("file:".length)))
      : new Uint8Array(
          execFileSync("git", ["show", id], { cwd: here, maxBuffer: 1 << 28 }),
        );
