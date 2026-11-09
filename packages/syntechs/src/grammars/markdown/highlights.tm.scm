; Patterns appended after tree-sitter-markdown's highlight queries (block, then inline), for the structure VS Code's
; markdown grammar scopes and the upstream queries leave uncaptured: a heading's level, a block quote, a table, a
; fence's info string. A pattern here wins over an upstream one on the same node. The scopes each capture paints
; are in src/highlight/rules.node.ts.

(atx_heading (atx_h1_marker)) @heading.1
(atx_heading (atx_h2_marker)) @heading.2
(atx_heading (atx_h3_marker)) @heading.3
(atx_heading (atx_h4_marker)) @heading.4
(atx_heading (atx_h5_marker)) @heading.5
(atx_heading (atx_h6_marker)) @heading.6
(setext_heading (setext_h1_underline)) @heading.1
(setext_heading (setext_h2_underline)) @heading.2

(block_quote) @quote

; A continuation line's prefix is a quote marker only where it holds `>`; in a list it is the indentation.
((block_continuation) @quote.marker
 (#match? @quote.marker ">"))

(pipe_table) @table
(pipe_table_delimiter_row) @table.delimiter
(pipe_table_header "|" @table.delimiter)
(pipe_table_row "|" @table.delimiter)

(info_string) @fence.language

(strikethrough) @text.strike

; An HTML block that opens a comment (`<!-- ... -->`, such as Node's YAML metadata) is a comment.
((html_block) @comment
 (#match? @comment "^<!--"))

; A reference link (`[text][label]`, `[text][]`) shows only its text when rendered: its brackets and label are markup.
(full_reference_link ["[" "]"] @punctuation.delimiter)
(full_reference_link (link_label) @punctuation.delimiter)
(collapsed_reference_link ["[" "]"] @punctuation.delimiter)

; An inline HTML tag (`<br/>`, `<kbd>`) renders as its effect, not as text: it is markup.
(html_tag) @punctuation.delimiter
