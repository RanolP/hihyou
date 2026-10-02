; What VS Code's regular expression grammar paints and the upstream query leaves bare, appended after it
; (rules.node.ts).

(character_class) @character.set
(class_range) @character.range
[
  (any_character)
  (unicode_property_value_expression)
] @character.class
(lazy) @operator
[
  (backreference_escape)
  (decimal_escape)
  (named_group_backreference)
] @backreference
(unicode_character_escape) @escape
