import type { AstSteps } from "./anchor.js";
import type { Host, HostAuthor } from "./host.js";

/** The stored half of an anchor; `Diffset.anchor` turns it into an `Anchor`. */
export interface AnchorData {
  side: "before" | "after";
  path: string;
  nodes: AstSteps[]; // non-empty; normalized: document order, descendants of an included ancestor dropped
}

export interface ReviewThreads<H extends Host> {
  diffsetId: string; // joins Diffset.id, 1:1
  grammars: Record<string, string>; // language name -> Grammar.id used while reviewing
  ran: Author<H>[]; // who ran/tested this whole Diffset (Gerrit's "Verified")
  threads: ReviewThread<H>[];
}

export interface ReviewThread<H extends Host> {
  id: string;
  anchor: AnchorData;
  comments: ReviewComment<H>[]; // oldest first
}

export interface ReviewComment<H extends Host> {
  author: Author<H>;
  draft: boolean; // publishing flips draft -> false
  verdict?: Verdict; // verdict lives on the anchored comment only
  // body: still unspecified, but a comment may have no body
}

export type RequestAxis = "necessity" | "clarity" | "consistency";

export interface Verdict {
  rubric: string; // id@version of the axis set, e.g. "hihyou-taste@1"
  claims: { read?: true; owner?: true };
  requests: RequestAxis[]; // axis present = -1 (change requested on that axis)
  design?: -2 | -1 | 0 | 1 | 2; // optional axis
}

/** Host-defined opaque type (room for display name, avatar). The only constraint: an id. */
export type Author<H extends Host> = { id: string } & HostAuthor<H>;
