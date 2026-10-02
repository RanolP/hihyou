; What VS Code's JSDoc grammar paints and the upstream query leaves bare, appended after it (rules.node.ts).

; A tag's type includes its braces.
(tag "{" @type "}" @type)

; The name a tag documents: `@param {T} name`.
(tag (tag_name) (identifier) @variable)

; `{@link Target text}` reads as a type around the tag and its target.
(inline_tag) @type
(inline_tag (tag_name) @keyword)
(inline_tag (description) @variable.description)

; `@see` followed by a bare URL reads as a link, and `@default`'s one-word value as a variable.
((tag (tag_name) @_tag (description) @link)
  (#eq? @_tag "@see")
  (#match? @link "^https?://\\S+$"))
((tag (tag_name) @_tag (description) @variable)
  (#eq? @_tag "@default")
  (#match? @variable "^\\S+$"))
