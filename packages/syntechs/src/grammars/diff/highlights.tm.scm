; Whole-line scopes from VS Code's Diff grammar. These follow the upstream query so each wins over the
; token-level capture on the same node and leaves embedded source scopes free to paint inside hunk lines.
(addition) @line.inserted
(deletion) @line.deleted
(change) @line.changed
(location) @range.unified
(old_file) @header.from-file
(new_file) @header.to-file
(command) @header.git
(index) @header.index
