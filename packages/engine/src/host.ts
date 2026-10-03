import type { Language, Tree } from "syntechs/core";
import type { Formatted } from "syntechs/fmt";
import type { ScopeRules } from "syntechs/diff";
import type { HighlightModule } from "syntechs/highlight";
import { type Cache, createCache } from "./cache.js";
import { type Diffset, openDiffset } from "./diffset.js";

/** Host-issued opaque string; same content -> same id (e.g. git blob SHA). */
export type BlobId = string;

/** One node of a syntechs `Tree`, which names a node by a plain number. */
export type NodeId = number;

export interface ChangedFileRef {
  path: string;
  oldPath?: string;
  before: BlobId | null; // null = added
  after: BlobId | null; // null = deleted
  /** Content the engine must not read or parse; set by the host when it knows. */
  kind?: "binary" | "submodule";
}

export interface HostPreferences {
  /** LRU cap in bytes; `defaultCacheBytes` when absent. */
  cacheBytes?: number;
}

export interface GrammarLoader {
  forPath(path: string): Promise<Grammar | undefined>;
}

export interface Grammar {
  id: string;
  language: Language;
  format?: FormatModule;
  highlight?: HighlightModule;
  /** Node kinds an added or deleted node is a whole declaration as; see `NodeOutline.whole`. None when absent. */
  declarations?: ReadonlySet<string>;
  /** Node kinds (a class and its kin) whose body's `declarations` are whole like top-level ones. */
  containers?: ReadonlySet<string>;
  /** Lexical scoping, for alpha-normalizing local names in move claims; names are compared as written when absent. */
  scope?: ScopeRules;
}

/** A formatter with the host's options already bound in. */
export interface FormatModule {
  format(tree: Tree): Formatted;
}

/** Paints TextMate scopes over a tree, enclosing nodes first; syntechs ships one per grammar. */
export type { HighlightModule };

type Resolved = { id: string; changes: ChangedFileRef[] };

/** The execution environment. CLI, VS Code, browser extension each implement one. */
export interface Host {
  grammars: GrammarLoader;
  /**
   * Same data -> same result, always. A host declares its own parameter type, which becomes its
   * `SerializedDiffsetId`.
   */
  resolveDiffset(data: never): Resolved | Promise<Resolved>;
  readBlob(id: BlobId): Uint8Array | Promise<Uint8Array>;
  preferences?: HostPreferences;
  /** Type-only: the host's part of `Author`. Never read at runtime. */
  readonly authorType?: object;
}

/** The host's own serialized way of naming a change set: the parameter of its `resolveDiffset`. */
export type SerializedDiffsetId<H extends Host> = Parameters<
  H["resolveDiffset"]
>[0];

/** The host-specific part of `Author`, declared through `Host.authorType`. */
export type HostAuthor<H extends Host> = H extends {
  readonly authorType?: infer A;
}
  ? A extends object
    ? A
    : object
  : object;

export interface Engine<H extends Host> {
  diffset(data: SerializedDiffsetId<H>): Promise<Diffset<H>>;
}

/** What every engine object captures: the host and the one cache in front of it. */
export interface EngineContext {
  host: Host;
  cache: Cache;
}

export function createEngine<H extends Host>(host: H): Engine<H> {
  const ctx: EngineContext = {
    host,
    cache: createCache(() => host.preferences?.cacheBytes),
  };
  return { diffset: (data) => openDiffset<H>(ctx, data) };
}
