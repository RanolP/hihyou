; Appended after tree-sitter-json's highlight query. Upstream lists its key pattern before `(string) @string`
; for tree-sitter-highlight, where the first pattern on a node wins; here the later one wins, so the key pattern
; is repeated last for a key to keep VS Code's property-name scope rather than a value string's.

(pair
  key: (_) @string.special.key)
