export type PbxprojValue =
  | string
  | PbxprojValue[]
  | PbxprojDictionary
  | Uint8Array;

export interface PbxprojDictionary {
  [key: string]: PbxprojValue;
}

export interface Pbxproj {
  objects: Map<string, PbxprojDictionary>;
  rootObject: string;
}

export interface PbxprojFileChange {
  kind: "added" | "removed";
  path: string;
  target?: string;
  phase?: string;
}

export interface PbxprojPackageChange {
  kind: "added" | "removed";
  name: string;
  url?: string;
  requirement?: string;
}

export interface PbxprojTargetChange {
  kind: "added" | "removed";
  target: string;
  phase?: string;
}

export interface PbxprojSettingChange {
  target: string;
  configuration: string;
  key: string;
  before: string;
  after: string;
}

export interface PbxprojSummary {
  files: PbxprojFileChange[];
  packages: PbxprojPackageChange[];
  targets: PbxprojTargetChange[];
  settings: PbxprojSettingChange[];
  noise: PbxprojSettingChange[];
  addedProject?: { targets: number; files: number; settings: number };
}

class OpenStepParser {
  private index = 0;

  constructor(private readonly text: string) {}

  parse(): PbxprojValue {
    const value = this.value();
    this.space();
    if (this.index !== this.text.length) throw new Error("Trailing input");
    return value;
  }

  private value(): PbxprojValue {
    this.space();
    const character = this.text[this.index];
    if (character === "{") return this.dictionary();
    if (character === "(") return this.array();
    if (character === '"') return this.quoted();
    if (character === "<") return this.data();
    return this.bare();
  }

  private dictionary(): PbxprojDictionary {
    this.index++;
    const value: PbxprojDictionary = {};
    for (;;) {
      this.space();
      if (this.take("}")) return value;
      const key = this.string();
      this.space();
      this.expect("=");
      value[key] = this.value();
      this.space();
      this.expect(";");
    }
  }

  private array(): PbxprojValue[] {
    this.index++;
    const value: PbxprojValue[] = [];
    for (;;) {
      this.space();
      if (this.take(")")) return value;
      value.push(this.value());
      this.space();
      this.take(",");
    }
  }

  private string(): string {
    this.space();
    return this.text[this.index] === '"' ? this.quoted() : this.bare();
  }

  private quoted(): string {
    this.index++;
    let value = "";
    while (this.index < this.text.length) {
      const character = this.text[this.index++];
      if (character === '"') return value;
      if (character !== "\\") {
        value += character;
        continue;
      }
      const escaped = this.text[this.index++];
      if (escaped === undefined) throw new Error("Unterminated escape");
      value +=
        escaped === "n"
          ? "\n"
          : escaped === "r"
            ? "\r"
            : escaped === "t"
              ? "\t"
              : escaped;
    }
    throw new Error("Unterminated string");
  }

  private data(): Uint8Array {
    this.index++;
    const end = this.text.indexOf(">", this.index);
    if (end < 0) throw new Error("Unterminated data");
    const data = this.text.slice(this.index, end).replace(/\s/g, "");
    if (data.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(data))
      throw new Error("Invalid data");
    this.index = end + 1;
    return Uint8Array.from(data.match(/.{2}/g) ?? [], (byte) =>
      Number.parseInt(byte, 16),
    );
  }

  private bare(): string {
    const start = this.index;
    while (
      this.index < this.text.length &&
      !/[\s{}()=;,<>]/.test(this.text[this.index] ?? "")
    )
      this.index++;
    if (start === this.index) throw new Error("Expected string");
    return this.text.slice(start, this.index);
  }

  private space(): void {
    for (;;) {
      while (/\s/.test(this.text[this.index] ?? "")) this.index++;
      if (this.text.startsWith("/*", this.index)) {
        const end = this.text.indexOf("*/", this.index + 2);
        if (end < 0) throw new Error("Unterminated comment");
        this.index = end + 2;
      } else if (this.text.startsWith("//", this.index)) {
        const end = this.text.indexOf("\n", this.index + 2);
        this.index = end < 0 ? this.text.length : end + 1;
      } else return;
    }
  }

  private take(character: string): boolean {
    if (this.text[this.index] !== character) return false;
    this.index++;
    return true;
  }

  private expect(character: string): void {
    if (!this.take(character)) throw new Error(`Expected ${character}`);
  }
}

const isDictionary = (
  value: PbxprojValue | undefined,
): value is PbxprojDictionary =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Uint8Array);

const stringOf = (value: PbxprojValue | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

const stringsOf = (value: PbxprojValue | undefined): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" ? [item] : []))
    : [];

export const parsePbxproj = (text: string): Pbxproj | undefined => {
  try {
    const root = new OpenStepParser(text.replace(/^\uFEFF/, "")).parse();
    if (!isDictionary(root) || !isDictionary(root["objects"])) return undefined;
    const rootObject = stringOf(root["rootObject"]);
    if (rootObject === undefined || !/^[0-9a-f]{24}$/i.test(rootObject))
      return undefined;
    const objects = new Map<string, PbxprojDictionary>();
    for (const [id, object] of Object.entries(root["objects"]))
      if (/^[0-9a-f]{24}$/i.test(id) && isDictionary(object))
        objects.set(id, object);
    return { objects, rootObject };
  } catch {
    return undefined;
  }
};

const phaseNames: Record<string, string> = {
  PBXSourcesBuildPhase: "Compile Sources",
  PBXResourcesBuildPhase: "Copy Bundle Resources",
  PBXFrameworksBuildPhase: "Link Binary With Libraries",
  PBXHeadersBuildPhase: "Headers",
  PBXCopyFilesBuildPhase: "Copy Files",
  PBXShellScriptBuildPhase: "Run Script",
};

const objectName = (object: PbxprojDictionary | undefined, fallback: string) =>
  stringOf(object?.["name"]) ?? stringOf(object?.["path"]) ?? fallback;

const phaseName = (object: PbxprojDictionary | undefined, fallback: string) =>
  objectName(object, phaseNames[stringOf(object?.["isa"]) ?? ""] ?? fallback);

const idsWithIsa = (project: Pbxproj, isa: string): string[] =>
  [...project.objects].flatMap(([id, object]) =>
    object["isa"] === isa ? [id] : [],
  );

interface FilePlacement {
  path: string;
  target?: string;
  phase?: string;
}

const filePaths = (project: Pbxproj): Map<string, string> => {
  const parents = new Map<string, string>();
  for (const [id, object] of project.objects) {
    const isa = stringOf(object["isa"]);
    if (
      isa !== "PBXGroup" &&
      isa !== "PBXVariantGroup" &&
      isa !== "PBXFileSystemSynchronizedRootGroup"
    )
      continue;
    for (const child of stringsOf(object["children"])) parents.set(child, id);
  }
  const pathOf = (id: string): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      const object = project.objects.get(current);
      const part = stringOf(object?.["path"]) ?? stringOf(object?.["name"]);
      if (part !== undefined && part !== "<group>") parts.unshift(part);
      current = parents.get(current);
    }
    return parts.join("/");
  };
  return new Map(
    idsWithIsa(project, "PBXFileReference").map((id) => [id, pathOf(id)]),
  );
};

const filePlacements = (project: Pbxproj): Map<string, FilePlacement> => {
  const paths = filePaths(project);
  const phaseOwners = new Map<string, string>();
  for (const [id, object] of project.objects)
    if (object["isa"] === "PBXNativeTarget")
      for (const phase of stringsOf(object["buildPhases"]))
        phaseOwners.set(phase, objectName(object, id));
  const placements = new Map<string, FilePlacement>();
  for (const [phaseId, phase] of project.objects) {
    const name = phaseName(phase, phaseId);
    for (const buildFileId of stringsOf(phase["files"])) {
      const fileRef = stringOf(project.objects.get(buildFileId)?.["fileRef"]);
      if (fileRef === undefined) continue;
      const target = phaseOwners.get(phaseId);
      placements.set(buildFileId, {
        path:
          paths.get(fileRef) ??
          objectName(project.objects.get(fileRef), fileRef),
        ...(target !== undefined && { target }),
        phase: name,
      });
    }
  }
  return placements;
};

const changeKind = (
  before: Map<string, unknown>,
  after: Map<string, unknown>,
  id: string,
) =>
  before.has(id)
    ? after.has(id)
      ? undefined
      : ("removed" as const)
    : after.has(id)
      ? ("added" as const)
      : undefined;

const changedIds = (
  before: Map<string, unknown>,
  after: Map<string, unknown>,
): string[] =>
  [...new Set([...before.keys(), ...after.keys()])].filter(
    (id) => before.has(id) !== after.has(id),
  );

const filesDiff = (before: Pbxproj, after: Pbxproj): PbxprojFileChange[] => {
  const oldPlacements = filePlacements(before);
  const newPlacements = filePlacements(after);
  return changedIds(oldPlacements, newPlacements).flatMap((id) => {
    const kind = changeKind(oldPlacements, newPlacements, id);
    const placement =
      kind === "added" ? newPlacements.get(id) : oldPlacements.get(id);
    return kind === undefined || placement === undefined
      ? []
      : [{ kind, ...placement }];
  });
};

const requirementOf = (value: PbxprojValue | undefined): string | undefined => {
  if (!isDictionary(value)) return undefined;
  const kind = stringOf(value["kind"]);
  const version =
    stringOf(value["minimumVersion"]) ?? stringOf(value["version"]);
  const branch = stringOf(value["branch"]);
  const revision = stringOf(value["revision"]);
  if (branch !== undefined) return `branch ${branch}`;
  if (revision !== undefined) return `revision ${revision}`;
  return (
    [kind, version].filter((part) => part !== undefined).join(" ") || undefined
  );
};

const packageRecords = (
  project: Pbxproj,
): Map<string, Omit<PbxprojPackageChange, "kind">> => {
  const records = new Map<string, Omit<PbxprojPackageChange, "kind">>();
  const usedReferences = new Set<string>();
  for (const id of idsWithIsa(project, "XCSwiftPackageProductDependency")) {
    const object = project.objects.get(id);
    const referenceId = stringOf(object?.["package"]);
    const reference =
      referenceId === undefined ? undefined : project.objects.get(referenceId);
    if (referenceId !== undefined) usedReferences.add(referenceId);
    const url = stringOf(reference?.["repositoryURL"]);
    const requirement = requirementOf(reference?.["requirement"]);
    records.set(id, {
      name: stringOf(object?.["productName"]) ?? objectName(object, id),
      ...(url !== undefined && { url }),
      ...(requirement !== undefined && { requirement }),
    });
  }
  for (const id of idsWithIsa(project, "XCRemoteSwiftPackageReference")) {
    if (usedReferences.has(id)) continue;
    const object = project.objects.get(id);
    const url = stringOf(object?.["repositoryURL"]);
    const requirement = requirementOf(object?.["requirement"]);
    records.set(id, {
      name:
        url
          ?.split("/")
          .at(-1)
          ?.replace(/\.git$/, "") ?? objectName(object, id),
      ...(url !== undefined && { url }),
      ...(requirement !== undefined && { requirement }),
    });
  }
  return records;
};

const packagesDiff = (
  before: Pbxproj,
  after: Pbxproj,
): PbxprojPackageChange[] => {
  const oldPackages = packageRecords(before);
  const newPackages = packageRecords(after);
  return changedIds(oldPackages, newPackages).flatMap((id) => {
    const kind = changeKind(oldPackages, newPackages, id);
    const record = kind === "added" ? newPackages.get(id) : oldPackages.get(id);
    return kind === undefined || record === undefined
      ? []
      : [{ kind, ...record }];
  });
};

const targetsDiff = (
  before: Pbxproj,
  after: Pbxproj,
): PbxprojTargetChange[] => {
  const oldTargets = new Map(
    idsWithIsa(before, "PBXNativeTarget").map((id) => [
      id,
      before.objects.get(id),
    ]),
  );
  const newTargets = new Map(
    idsWithIsa(after, "PBXNativeTarget").map((id) => [
      id,
      after.objects.get(id),
    ]),
  );
  const targets: PbxprojTargetChange[] = changedIds(
    oldTargets,
    newTargets,
  ).flatMap((id) => {
    const kind = changeKind(oldTargets, newTargets, id);
    const object = kind === "added" ? newTargets.get(id) : oldTargets.get(id);
    return kind === undefined ? [] : [{ kind, target: objectName(object, id) }];
  });
  for (const id of [...oldTargets.keys()].filter((targetId) =>
    newTargets.has(targetId),
  )) {
    const oldTarget = oldTargets.get(id);
    const newTarget = newTargets.get(id);
    const oldPhases = new Map(
      stringsOf(oldTarget?.["buildPhases"]).map((phaseId) => [
        phaseId,
        before.objects.get(phaseId),
      ]),
    );
    const newPhases = new Map(
      stringsOf(newTarget?.["buildPhases"]).map((phaseId) => [
        phaseId,
        after.objects.get(phaseId),
      ]),
    );
    for (const phaseId of changedIds(oldPhases, newPhases)) {
      const kind = changeKind(oldPhases, newPhases, phaseId);
      const phase =
        kind === "added" ? newPhases.get(phaseId) : oldPhases.get(phaseId);
      if (kind !== undefined)
        targets.push({
          kind,
          target: objectName(newTarget ?? oldTarget, id),
          phase: phaseName(phase, phaseId),
        });
    }
  }
  return targets;
};

interface Configuration {
  target: string;
  name: string;
  settings: PbxprojDictionary;
}

const configurations = (project: Pbxproj): Map<string, Configuration> => {
  const owners = new Map<string, string>();
  for (const [id, object] of project.objects) {
    const list = stringOf(object["buildConfigurationList"]);
    if (list === undefined) continue;
    const target =
      object["isa"] === "PBXProject" ? "Project" : objectName(object, id);
    owners.set(list, target);
  }
  const result = new Map<string, Configuration>();
  for (const [listId, target] of owners) {
    for (const configurationId of stringsOf(
      project.objects.get(listId)?.["buildConfigurations"],
    )) {
      const object = project.objects.get(configurationId);
      const settings = object?.["buildSettings"];
      if (!isDictionary(settings)) continue;
      const name = stringOf(object?.["name"]) ?? configurationId;
      result.set(`${target}\0${name}`, { target, name, settings });
    }
  }
  return result;
};

const displayValue = (value: PbxprojValue | undefined): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(displayValue).join(" ");
  if (value instanceof Uint8Array)
    return `<${[...value].map((byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
  return value === undefined ? "" : JSON.stringify(value);
};

const tokens = (value: PbxprojValue | undefined): string[] =>
  Array.isArray(value)
    ? value.flatMap(tokens)
    : typeof value === "string"
      ? (value
          .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
          ?.map((token) => token.replace(/^(?:"(.*)"|'(.*)')$/, "$1$2")) ?? [])
      : [displayValue(value)];

const settingsDiff = (before: Pbxproj, after: Pbxproj) => {
  const oldConfigurations = configurations(before);
  const newConfigurations = configurations(after);
  const settings: PbxprojSettingChange[] = [];
  const noise: PbxprojSettingChange[] = [];
  for (const id of [...oldConfigurations.keys()].filter((configurationId) =>
    newConfigurations.has(configurationId),
  )) {
    const oldConfiguration = oldConfigurations.get(id);
    const newConfiguration = newConfigurations.get(id);
    if (oldConfiguration === undefined || newConfiguration === undefined)
      continue;
    const keys = new Set([
      ...Object.keys(oldConfiguration.settings),
      ...Object.keys(newConfiguration.settings),
    ]);
    for (const key of keys) {
      const beforeValue = oldConfiguration.settings[key];
      const afterValue = newConfiguration.settings[key];
      if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
      const change = {
        target: newConfiguration.target,
        configuration: newConfiguration.name,
        key,
        before: displayValue(beforeValue),
        after: displayValue(afterValue),
      };
      const shapeOnly =
        Array.isArray(beforeValue) !== Array.isArray(afterValue) &&
        JSON.stringify(tokens(beforeValue)) ===
          JSON.stringify(tokens(afterValue));
      (shapeOnly ? noise : settings).push(change);
    }
  }
  return { settings, noise };
};

const emptyProject = (): Pbxproj => ({ objects: new Map(), rootObject: "" });

export const diffPbxproj = (
  beforeText: string,
  afterText: string,
): PbxprojSummary | undefined => {
  const before =
    beforeText.trim() === "" ? emptyProject() : parsePbxproj(beforeText);
  const after =
    afterText.trim() === "" ? emptyProject() : parsePbxproj(afterText);
  if (before === undefined || after === undefined) return undefined;
  if (beforeText.trim() === "") {
    return {
      files: [],
      packages: [],
      targets: [],
      settings: [],
      noise: [],
      addedProject: {
        targets: idsWithIsa(after, "PBXNativeTarget").length,
        files: idsWithIsa(after, "PBXFileReference").length,
        settings: [...configurations(after).values()].reduce(
          (count, configuration) =>
            count + Object.keys(configuration.settings).length,
          0,
        ),
      },
    };
  }
  return {
    files: filesDiff(before, after),
    packages: packagesDiff(before, after),
    targets: targetsDiff(before, after),
    ...settingsDiff(before, after),
  };
};
