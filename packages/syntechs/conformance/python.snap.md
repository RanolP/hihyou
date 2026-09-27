python compatibility: 202/327 (61.77%), 88 refused (ok:false), 49 excluded

Fixtures: ruff 0.16.8 crates/ruff_python_formatter/resources/test/fixtures/{black,ruff} (recursive), every option set of each `.options.json`, expected output from tests/snapshots (black cases without a snapshot: their `.expect` file). Options are passed by their ruff.toml names.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| black/cases/attribute_access_on_number_literals.py | 0/1 | 90.91% |
| black/cases/comments_in_blocks.py | 0/1 | 98.68% |
| black/cases/comments_non_breaking_space.py | 0/1 | 86.96% |
| black/cases/context_managers_38.py | 0/1 | 84.21% |
| black/cases/context_managers_autodetect_38.py | 0/1 | 92.31% |
| black/cases/expression.py | 0/1 | 54.95% |
| black/cases/import_comments.py | 0/1 | 84.44% |
| black/cases/pep_750.py | 0/1 | 90.67% |
| black/cases/power_op_newline.py | 0/1 | 76.92% |
| black/cases/preview_cantfit.py | 0/1 | 96.97% |
| black/cases/preview_hug_parens_with_braces_and_square_brackets.py | 0/1 | 48.53% |
| black/cases/preview_hug_parens_with_braces_and_square_brackets_no_ll1.py | 0/1 | 37.61% |
| black/cases/preview_import_line_collapse.py | 0/1 | 99.43% |
| black/cases/preview_long_dict_values.py | 0/1 | 90.30% |
| black/cases/preview_wrap_comprehension_in.py | 0/1 | 95.77% |
| black/cases/remove_with_brackets.py | 0/1 | 98.68% |
| ruff/docstring_code_examples.py | 4/10 | 94.91% |
| ruff/docstring_code_examples_dynamic_line_width.py | 0/4 | 57.97% |
| ruff/docstring_tab_indentation.py | 0/2 | 92.00% |
| ruff/empty_now_newline.py | 0/1 | 0.00% |
| ruff/empty_whitespace.py | 0/1 | 0.00% |
| ruff/expression/binary_implicit_string.py | 0/1 | 98.52% |
| ruff/expression/call.py | 0/1 | 98.53% |
| ruff/expression/compare.py | 0/1 | 98.68% |
| ruff/expression/join_implicit_concatenated_string_assignment.py | 0/1 | 97.11% |
| ruff/expression/join_implicit_concatenated_string_preserve.py | 0/2 | 88.64% |
| ruff/expression/slice.py | 0/1 | 94.07% |
| ruff/fluent.py | 0/1 | 72.22% |
| ruff/fmt_on_off/indent.py | 0/3 | 65.49% |
| ruff/parentheses/call_chains.py | 0/1 | 99.38% |
| ruff/skip_magic_trailing_comma.py | 0/2 | 95.76% |
| ruff/statement/assignment_split_value_first.py | 0/1 | 99.35% |
| ruff/statement/lazy_import.py | 0/1 | 68.97% |
| ruff/statement/try.py | 1/2 | 99.58% |
| ruff/statement/type_alias.py | 0/1 | 37.75% |
| ruff/tab_width.py | 1/3 | 76.08% |
| ruff/trailing_comments.py | 0/1 | 86.11% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| black/cases/backslash_before_indent.py | 1/1 | 84.21% | formatter-error: backslash continuation before a body at 14 |
| black/cases/cantfit.py | 1/1 | 97.30% | check: input "(" at 1689 is missing from the output |
| black/cases/comment_after_escaped_newline.py | 1/1 | 47.06% | formatter-error: backslash continuation before a body at 10 |
| black/cases/comments9.py | 1/1 | 92.93% | formatter-error: suppression comment at 2283 |
| black/cases/fmtonoff.py | 1/1 | 83.91% | formatter-error: suppression comment at 157 |
| black/cases/fmtonoff2.py | 1/1 | 100.00% | formatter-error: suppression comment at 34 |
| black/cases/fmtonoff3.py | 1/1 | 87.50% | formatter-error: suppression comment at 0 |
| black/cases/fmtonoff4.py | 1/1 | 100.00% | formatter-error: suppression comment at 0 |
| black/cases/fmtonoff5.py | 1/1 | 87.57% | formatter-error: suppression comment at 98 |
| black/cases/fmtonoff6.py | 1/1 | 100.00% | formatter-error: suppression comment at 147 |
| black/cases/fmtpass_imports.py | 1/1 | 97.44% | formatter-error: suppression comment at 95 |
| black/cases/fmtskip.py | 1/1 | 100.00% | formatter-error: suppression comment at 22 |
| black/cases/fmtskip10.py | 1/1 | 76.60% | formatter-error: suppression comment at 26 |
| black/cases/fmtskip11.py | 1/1 | 92.94% | formatter-error: suppression comment at 22 |
| black/cases/fmtskip12.py | 1/1 | 75.00% | formatter-error: suppression comment at 50 |
| black/cases/fmtskip13.py | 1/1 | 70.59% | formatter-error: suppression comment at 119 |
| black/cases/fmtskip2.py | 1/1 | 25.00% | formatter-error: suppression comment at 244 |
| black/cases/fmtskip3.py | 1/1 | 58.82% | formatter-error: suppression comment at 10 |
| black/cases/fmtskip4.py | 1/1 | 20.00% | formatter-error: suppression comment at 8 |
| black/cases/fmtskip5.py | 1/1 | 66.67% | formatter-error: suppression comment at 62 |
| black/cases/fmtskip6.py | 1/1 | 100.00% | formatter-error: suppression comment at 100 |
| black/cases/fmtskip7.py | 1/1 | 25.00% | formatter-error: suppression comment at 47 |
| black/cases/fmtskip8.py | 1/1 | 100.00% | formatter-error: suppression comment at 86 |
| black/cases/fmtskip9.py | 1/1 | 0.00% | formatter-error: suppression comment at 9 |
| black/cases/fmtskip_multiple_in_clause.py | 1/1 | 82.05% | formatter-error: suppression comment at 0 |
| black/cases/fmtskip_multiple_strings.py | 1/1 | 86.49% | formatter-error: suppression comment at 0 |
| black/cases/generics_wrapping.py | 1/1 | 56.48% | formatter-error: comment in type parameters at 1546 |
| black/cases/jupytext_markdown_fmt.py | 1/1 | 100.00% | formatter-error: suppression comment at 0 |
| black/cases/pattern_matching_extras.py | 1/1 | 100.00% | formatter-error: tuple subject in a match at 515 |
| black/cases/pattern_matching_long.py | 1/1 | 33.33% | formatter-error: long unparenthesized case pattern at 62 |
| black/cases/pattern_matching_style.py | 1/1 | 46.81% | formatter-error: comment in a pattern at 474 |
| black/cases/pattern_matching_trailing_comma.py | 1/1 | 59.46% | formatter-error: tuple subject in a match at 0 |
| black/cases/pattern_matching_with_if_stmt.py | 1/1 | 51.35% | formatter-error: long unparenthesized case pattern at 120 |
| black/cases/pep_572_remove_parens.py | 1/1 | 98.55% | check: input "(" at 846 is output as "x" at 835, which means "x", not "(" |
| black/cases/pep_701.py | 1/1 | 93.33% | check: input "f\"{'\\''}\"" at 2276 is output as "f\"{\"'\"}\"" at 2230, which means "0:S\u0000{\"\"\"}\u0000", not "0:S |
| black/cases/preview_fmtpass_imports.py | 1/1 | 97.44% | formatter-error: suppression comment at 95 |
| black/cases/preview_long_strings__regression.py | 1/1 | 96.81% | check: input "F\"{F'{humanize_number(pos)}.': <{pound_len+2}} \"\n    F\"{balance: <{bal_len + 5}} \"\n    F\"<<{author. |
| black/cases/remove_except_types_parens.py | 1/1 | 95.12% | check: input "," at 721 is output as ":" at 713, which means ":", not "," |
| black/cases/remove_for_brackets.py | 1/1 | 90.20% | check: input "(" at 672 is output as "k" at 693, which means "k", not "(" |
| black/cases/remove_parens_from_lhs.py | 1/1 | 100.00% | formatter-error: unsupported pattern: list_splat_pattern at 203 |
| black/cases/single_line_format_skip_with_multiple_comments.py | 1/1 | 25.00% | formatter-error: suppression comment at 12 |
| black/cases/type_param_defaults.py | 1/1 | 29.03% | formatter-error: parse error: ERROR at 7 |
| black/cases/type_params.py | 1/1 | 20.90% | formatter-error: unsupported type parameter lambda at 542 |
| ruff/expression/dict_comp.py | 1/1 | 99.07% | check: input comment "# if2" is missing from the output |
| ruff/expression/fstring.py | 2/2 | 57.40% | formatter-error: parse error: ERROR at 21682 |
| ruff/expression/fstring_multiline_replacement_field.py | 2/2 | 68.75% | check: input "f\"aaaaaaaaaaa {[ttttteeeeeeeeest,]} more {\n    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa |
| ruff/expression/join_implicit_concatenated_string.py | 1/1 | 97.62% | check: input "f\"{'Hy \\\"User\\\"'}\" 'more'" at 470 is output as "f\"{'Hy \"User\"'}more\"" at 455, which means "0:S\u |
| ruff/expression/lambda.py | 1/1 | 99.11% | check: input comment "# 2" is missing from the output |
| ruff/expression/list_comp.py | 1/1 | 98.99% | check: input comment "# if2" is missing from the output |
| ruff/expression/list_comp_py315.py | 1/1 | 73.53% | formatter-error: parse error: ERROR at 250 |
| ruff/expression/nested_string_quote_style.py | 4/4 | 87.50% | check: input "f'\"double\" quotes and {\"nested string with \\\"double\\\" quotes\"}'" at 881 is output as "f'\"double\" |
| ruff/expression/set_comp.py | 1/1 | 96.61% | check: input comment "# if2" is missing from the output |
| ruff/expression/tstring.py | 1/1 | 55.30% | formatter-error: parse error: ERROR at 21234 |
| ruff/fmt_on_off/comments.py | 1/1 | 92.86% | formatter-error: suppression comment at 6 |
| ruff/fmt_on_off/empty_file.py | 1/1 | 80.00% | formatter-error: suppression comment at 0 |
| ruff/fmt_on_off/fmt_off_docstring.py | 2/2 | 57.89% | formatter-error: suppression comment at 16 |
| ruff/fmt_on_off/fmt_off_unclosed_deep_nested_trailing_comment.py | 1/1 | 100.00% | formatter-error: suppression comment at 69 |
| ruff/fmt_on_off/fmt_off_unclosed_trailing_comment.py | 1/1 | 100.00% | formatter-error: suppression comment at 69 |
| ruff/fmt_on_off/form_feed.py | 1/1 | 93.33% | formatter-error: suppression comment at 0 |
| ruff/fmt_on_off/last_statement.py | 1/1 | 85.71% | formatter-error: suppression comment at 16 |
| ruff/fmt_on_off/mixed_space_and_tab.py | 3/3 | 34.41% | formatter-error: suppression comment at 13 |
| ruff/fmt_on_off/newlines.py | 1/1 | 94.74% | formatter-error: suppression comment at 21 |
| ruff/fmt_on_off/no_fmt_on.py | 1/1 | 84.21% | formatter-error: suppression comment at 16 |
| ruff/fmt_on_off/off_on_off_on.py | 1/1 | 81.69% | formatter-error: suppression comment at 59 |
| ruff/fmt_on_off/simple.py | 1/1 | 77.78% | formatter-error: suppression comment at 26 |
| ruff/fmt_on_off/trailing_comments.py | 1/1 | 79.01% | formatter-error: suppression comment at 7 |
| ruff/fmt_on_off/trailing_semicolon.py | 1/1 | 94.55% | formatter-error: suppression comment at 13 |
| ruff/fmt_on_off/yapf.py | 1/1 | 82.35% | formatter-error: suppression comment at 26 |
| ruff/fmt_skip/compound_one_liners.py | 1/1 | 78.18% | formatter-error: suppression comment at 0 |
| ruff/fmt_skip/decorators.py | 1/1 | 77.42% | formatter-error: suppression comment at 195 |
| ruff/fmt_skip/docstrings.py | 1/1 | 53.85% | formatter-error: suppression comment at 100 |
| ruff/fmt_skip/match.py | 1/1 | 88.59% | formatter-error: suppression comment at 45 |
| ruff/fmt_skip/or_else.py | 1/1 | 87.10% | formatter-error: suppression comment at 139 |
| ruff/fmt_skip/parentheses.py | 1/1 | 85.00% | formatter-error: suppression comment at 135 |
| ruff/fmt_skip/reason.py | 1/1 | 66.67% | formatter-error: suppression comment at 22 |
| ruff/fmt_skip/semicolons.py | 1/1 | 56.75% | formatter-error: suppression comment at 30 |
| ruff/fmt_skip/top_level_semicolon.py | 1/1 | 56.52% | formatter-error: suppression comment at 51 |
| ruff/fmt_skip/trailing_semi.py | 1/1 | 60.00% | formatter-error: suppression comment at 8 |
| ruff/fmt_skip/type_params.py | 1/1 | 82.50% | formatter-error: suppression comment at 26 |
| ruff/newlines.py | 1/1 | 89.65% | formatter-error: suppression comment at 2388 |
| ruff/parentheses/opening_parentheses_comment_empty.py | 1/1 | 89.39% | formatter-error: comment in a pattern at 595 |
| ruff/parentheses/opening_parentheses_comment_value.py | 1/1 | 56.97% | formatter-error: comment in a pattern at 606 |
| ruff/pattern/pattern_maybe_parenthesize.py | 1/1 | 84.53% | formatter-error: long unparenthesized case pattern at 1135 |
| ruff/pattern_match_regression_brackets.py | 1/1 | 100.00% | formatter-error: tuple subject in a match at 201 |
| ruff/statement/class_definition.py | 1/1 | 78.26% | formatter-error: comment in type parameters at 2989 |
| ruff/statement/function.py | 1/1 | 66.32% | formatter-error: comment in type parameters at 1334 |
| ruff/statement/match.py | 1/1 | 71.21% | formatter-error: long unparenthesized case pattern at 1521 |
| ruff/statement/with.py | 2/2 | 70.13% | formatter-error: unsupported expression: as_pattern at 5094 |

# Excluded

## no expected output (2)

- ruff/docstring_code_examples_crlf.py
- ruff/f-string-carriage-return-newline.py

## notebook (`source_type: Ipynb`) (1)

- ruff/notebook_docstring.py

## range formatting (32)

- black/cases/line_ranges_basic.py
- black/cases/line_ranges_decorator_edge_case.py
- black/cases/line_ranges_diff_edge_case.py
- black/cases/line_ranges_exceeding_end.py
- black/cases/line_ranges_fmt_off.py
- black/cases/line_ranges_fmt_off_decorator.py
- black/cases/line_ranges_fmt_off_overlap.py
- black/cases/line_ranges_imports.py
- black/cases/line_ranges_indentation.py
- black/cases/line_ranges_two_passes.py
- black/cases/line_ranges_unwrapping.py
- ruff/range_formatting/ancestory.py
- ruff/range_formatting/clause_header.py
- ruff/range_formatting/comment_only_range.py
- ruff/range_formatting/decorators.py
- ruff/range_formatting/docstring_code_examples.py
- ruff/range_formatting/empty_file.py
- ruff/range_formatting/empty_range.py
- ruff/range_formatting/end_of_file.py
- ruff/range_formatting/fmt_on_off.py
- ruff/range_formatting/fmt_skip.py
- ruff/range_formatting/indent.py
- ruff/range_formatting/leading_comments.py
- ruff/range_formatting/leading_trailing_comments.py
- ruff/range_formatting/module.py
- ruff/range_formatting/parentheses.py
- ruff/range_formatting/range_narrowing.py
- ruff/range_formatting/regressions.py
- ruff/range_formatting/same_line_body.py
- ruff/range_formatting/stub.pyi
- ruff/range_formatting/trailing_comments.py
- ruff/range_formatting/whitespace_only_range.py

## stub file (.pyi, or `source_type: Stub`): format() takes no path to tell the source type (14)

- black/cases/ignore_pyi.pyi
- black/cases/nested_stub.pyi
- black/cases/stub.pyi
- black/miscellaneous/force_pyi.pyi
- ruff/newlines.pyi
- ruff/statement/ellipsis.pyi
- ruff/statement/top_level.pyi
- ruff/stub_files/blank_line_after_nested_stub_class.pyi
- ruff/stub_files/blank_line_after_nested_stub_class_eof.pyi
- ruff/stub_files/comments.pyi
- ruff/stub_files/decorated_class_after_function.pyi
- ruff/stub_files/nesting.pyi
- ruff/stub_files/suite.pyi
- ruff/stub_files/top_level.pyi
