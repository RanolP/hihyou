// YAML's layout in the formatter DSL (src/fmt/dsl/dsl.ts); `pnpm generate` compiles it into fmt.gen.ts, whose
// rules write through sink.ts. print.ts ports prettier's YAML printer, which lays a stream out as lines it measures
// as it goes and reaches every node through that node's rule here: a leaf's rule spells it, a structural kind's is
// a custom rule (print.ts's `customs`) that lays it out at the indent and comment range its holder passes it.
//
// No rule: a block node and the scalars' parts. A block node is properties and one collection or block scalar,
// and where the properties go depends on what holds it (a document, a `-` or `?`, a key's value), so that holder's
// rule places them and prints the content by its rule. A plain scalar's typed parts (`integer_scalar`, ...), an
// anchor's or alias's name, a tag's handle and a directive's name and parameters print as part of their parent.
import { custom, defineFormat, text, verbatim } from "../../fmt/dsl/dsl.js";
import type { grammar } from "./bundle.js";
import type { YamlOptions } from "./fmt.js";

const format = defineFormat<typeof grammar, YamlOptions>();

export const yaml = format({
  structure: {
    // Comments are placed by print.ts, which reads the stream's comments in source order (fmt.ts's language
    // attaches none), around the documents.
    stream: () => custom("stream"),
    // Directives, markers and content, with the comments and blank lines between them.
    document: () => custom("document"),
    // A block collection lays its items out one per line, each with the comments before it, measured against the
    // item's source column.
    block_mapping: () => custom("blockCollection"),
    block_sequence: () => custom("blockCollection"),
    // A pair goes explicit (`? key`) or implicit by its key's printed width and the comments around its colon; an
    // item's content lays out after the `-` by its kind.
    block_mapping_pair: () => custom("mappingPair"),
    block_sequence_item: () => custom("sequenceItem"),
    // A block scalar re-indents and chomps its content, which the source offsets around it decide.
    block_scalar: () => custom("blockScalar"),
    // A flow node fits on its line from the column its holder has reached, else breaks its collection; a flow
    // pair likewise, its key and value each laid out by their rules.
    flow_node: () => custom("flowNode"),
    flow_mapping: () => custom("brokenFlow"),
    flow_sequence: () => custom("brokenFlow"),
    flow_pair: () => custom("flowPair"),
    // Leaves: printed as written, but a quoted scalar takes the quote prettier picks and a directive's words one
    // space apart.
    anchor: () => verbatim,
    tag: () => verbatim,
    alias: () => verbatim,
    comment: () => verbatim,
    plain_scalar: () => verbatim,
    double_quote_scalar: () => text("yamlQuote"),
    single_quote_scalar: () => text("yamlQuote"),
    yaml_directive: () => text("spaced"),
    tag_directive: () => text("spaced"),
    reserved_directive: () => text("spaced"),
  },
});
