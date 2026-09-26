python compatibility: 71/327 (21.71%), 240 refused (ok:false), 49 excluded

Fixtures: ruff 0.16.8 crates/ruff_python_formatter/resources/test/fixtures/{black,ruff} (recursive), every option set of each `.options.json`, expected output from tests/snapshots (black cases without a snapshot: their `.expect` file). Options are passed by their ruff.toml names.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| black/cases/expression.py | 0/1 | 54.95% |
| black/cases/pep_750.py | 0/1 | 90.67% |
| black/cases/power_op_newline.py | 0/1 | 76.92% |
| black/cases/preview_hug_parens_with_braces_and_square_brackets_no_ll1.py | 0/1 | 37.61% |
| black/cases/preview_wrap_comprehension_in.py | 0/1 | 95.77% |
| ruff/empty_now_newline.py | 0/1 | 0.00% |
| ruff/empty_whitespace.py | 0/1 | 0.00% |
| ruff/expression/join_implicit_concatenated_string_assignment.py | 0/1 | 97.11% |
| ruff/expression/join_implicit_concatenated_string_preserve.py | 0/2 | 88.64% |
| ruff/fluent.py | 0/1 | 72.22% |
| ruff/fmt_on_off/indent.py | 0/3 | 65.49% |
| ruff/statement/assignment_split_value_first.py | 0/1 | 99.35% |
| ruff/statement/lazy_import.py | 0/1 | 68.97% |
| ruff/statement/type_alias.py | 0/1 | 37.75% |
| ruff/tab_width.py | 1/3 | 76.08% |
| ruff/trailing_comments.py | 0/1 | 86.11% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| black/cases/allow_empty_first_line.py | 1/1 | 90.32% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/annotations.py | 1/1 | 57.14% | formatter-error: no rule for ClassDef at 28 |
| black/cases/async_stmts.py | 1/1 | 72.73% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/attribute_access_on_number_literals.py | 1/1 | 27.27% | formatter-error: no rule for If at 396 |
| black/cases/backslash_before_indent.py | 1/1 | 84.21% | formatter-error: no rule for ClassDef at 0 |
| black/cases/bracketmatch.py | 1/1 | 20.00% | formatter-error: no rule for For at 0 |
| black/cases/bytes_docstring.py | 1/1 | 68.75% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/cantfit.py | 1/1 | 51.11% | formatter-error: no rule for For at 1206 |
| black/cases/class_blank_parentheses.py | 1/1 | 64.15% | formatter-error: no rule for ClassDef at 0 |
| black/cases/class_methods_new_line.py | 1/1 | 75.47% | formatter-error: no rule for ClassDef at 0 |
| black/cases/collections.py | 1/1 | 60.00% | formatter-error: no rule for For at 868 |
| black/cases/comment_after_escaped_newline.py | 1/1 | 47.06% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/comments.py | 1/1 | 100.00% | formatter-error: no rule for Try at 253 |
| black/cases/comments2.py | 1/1 | 64.79% | formatter-error: no rule for If at 1053 |
| black/cases/comments3.py | 1/1 | 100.00% | formatter-error: no rule for FunctionDef at 60 |
| black/cases/comments4.py | 1/1 | 100.00% | formatter-error: no rule for ClassDef at 297 |
| black/cases/comments5.py | 1/1 | 100.00% | formatter-error: no rule for While at 0 |
| black/cases/comments6.py | 1/1 | 90.69% | formatter-error: no rule for FunctionDef at 32 |
| black/cases/comments9.py | 1/1 | 92.93% | formatter-error: suppression comment at 2283 |
| black/cases/comments_in_blocks.py | 1/1 | 89.29% | formatter-error: no rule for FunctionDef at 791 |
| black/cases/comments_in_double_parens.py | 1/1 | 70.37% | formatter-error: no rule for If at 0 |
| black/cases/comments_non_breaking_space.py | 1/1 | 33.33% | formatter-error: no rule for FunctionDef at 303 |
| black/cases/composition.py | 1/1 | 98.89% | formatter-error: no rule for ClassDef at 0 |
| black/cases/composition_no_trailing_comma.py | 1/1 | 93.89% | formatter-error: no rule for ClassDef at 0 |
| black/cases/conditional_expression.py | 1/1 | 74.87% | formatter-error: no rule for FunctionDef at 924 |
| black/cases/context_managers_38.py | 1/1 | 61.22% | formatter-error: no rule for With at 0 |
| black/cases/context_managers_39.py | 1/1 | 51.11% | formatter-error: no rule for With at 0 |
| black/cases/context_managers_autodetect_310.py | 1/1 | 60.00% | formatter-error: no rule for Match at 63 |
| black/cases/context_managers_autodetect_311.py | 1/1 | 62.50% | formatter-error: no rule for Try at 50 |
| black/cases/context_managers_autodetect_38.py | 1/1 | 79.07% | formatter-error: no rule for With at 149 |
| black/cases/context_managers_autodetect_39.py | 1/1 | 45.16% | formatter-error: no rule for With at 76 |
| black/cases/docstring.py | 1/1 | 60.79% | formatter-error: no rule for ClassDef at 0 |
| black/cases/docstring_no_extra_empty_line_before_eof.py | 1/1 | 100.00% | formatter-error: no rule for ClassDef at 91 |
| black/cases/docstring_no_string_normalization.py | 1/1 | 56.91% | formatter-error: no rule for ClassDef at 0 |
| black/cases/docstring_preview.py | 1/1 | 94.95% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/dummy_implementations.py | 1/1 | 63.41% | formatter-error: no rule for ClassDef at 56 |
| black/cases/empty_lines.py | 1/1 | 88.40% | formatter-error: no rule for FunctionDef at 37 |
| black/cases/f_docstring.py | 1/1 | 66.67% | formatter-error: no rule for FunctionDef at 0 |
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
| black/cases/form_feeds.py | 1/1 | 66.06% | formatter-error: no rule for FunctionDef at 529 |
| black/cases/funcdef_return_type_trailing_comma.py | 1/1 | 69.40% | formatter-error: no rule for FunctionDef at 37 |
| black/cases/function.py | 1/1 | 42.32% | formatter-error: no rule for FunctionDef at 177 |
| black/cases/function2.py | 1/1 | 84.48% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/function_trailing_comma.py | 1/1 | 56.39% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/generics_wrapping.py | 1/1 | 56.48% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/import_comments.py | 1/1 | 84.44% | check: output comment "# alpha  # beta" matches no input comment |
| black/cases/jupytext_markdown_fmt.py | 1/1 | 100.00% | formatter-error: suppression comment at 0 |
| black/cases/keep_newline_after_match.py | 1/1 | 84.85% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/linelength6.py | 1/1 | 100.00% | formatter-error: no rule for FunctionDef at 70 |
| black/cases/long_strings__type_annotations.py | 1/1 | 62.96% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/long_strings_flag_disabled.py | 1/1 | 96.27% | formatter-error: no rule for FunctionDef at 10575 |
| black/cases/module_docstring_followed_by_class.py | 1/1 | 75.00% | formatter-error: no rule for ClassDef at 60 |
| black/cases/module_docstring_followed_by_function.py | 1/1 | 75.00% | formatter-error: no rule for FunctionDef at 67 |
| black/cases/no_blank_line_before_docstring.py | 1/1 | 85.25% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/parenthesized_context_managers.py | 1/1 | 76.19% | formatter-error: unsupported expression: as_pattern at 6 |
| black/cases/pattern_matching_complex.py | 1/1 | 100.00% | formatter-error: no rule for Match at 73 |
| black/cases/pattern_matching_extras.py | 1/1 | 100.00% | formatter-error: no rule for Match at 14 |
| black/cases/pattern_matching_generic.py | 1/1 | 100.00% | formatter-error: no rule for With at 21 |
| black/cases/pattern_matching_long.py | 1/1 | 33.33% | formatter-error: no rule for Match at 0 |
| black/cases/pattern_matching_simple.py | 1/1 | 100.00% | formatter-error: no rule for Match at 39 |
| black/cases/pattern_matching_style.py | 1/1 | 46.81% | formatter-error: no rule for Match at 0 |
| black/cases/pattern_matching_trailing_comma.py | 1/1 | 59.46% | formatter-error: no rule for Match at 0 |
| black/cases/pattern_matching_with_if_stmt.py | 1/1 | 51.35% | formatter-error: no rule for Match at 0 |
| black/cases/pep604_union_types_line_breaks.py | 1/1 | 57.14% | formatter-error: no rule for FunctionDef at 1546 |
| black/cases/pep646_typed_star_arg_type_var_tuple.py | 1/1 | 100.00% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/pep_570.py | 1/1 | 100.00% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/pep_572.py | 1/1 | 100.00% | formatter-error: no rule for If at 18 |
| black/cases/pep_572_py310.py | 1/1 | 100.00% | formatter-error: no rule for If at 197 |
| black/cases/pep_572_remove_parens.py | 1/1 | 85.51% | formatter-error: no rule for If at 0 |
| black/cases/pep_604.py | 1/1 | 40.00% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/pep_646.py | 1/1 | 100.00% | formatter-error: no rule for FunctionDef at 1041 |
| black/cases/pep_654.py | 1/1 | 100.00% | formatter-error: no rule for Try at 0 |
| black/cases/pep_654_style.py | 1/1 | 85.19% | formatter-error: no rule for Try at 0 |
| black/cases/pep_701.py | 1/1 | 93.33% | check: input "f\"{'\\''}\"" at 2276 is output as "f\"{\"'\"}\"" at 2230, which means "0:S\u0000{\"\"\"}\u0000", not "0:S |
| black/cases/power_op_spacing.py | 1/1 | 84.72% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/preview_cantfit.py | 1/1 | 56.10% | formatter-error: no rule for For at 1206 |
| black/cases/preview_comments7.py | 1/1 | 81.63% | formatter-error: no rule for FunctionDef at 1103 |
| black/cases/preview_fmtpass_imports.py | 1/1 | 97.44% | formatter-error: suppression comment at 95 |
| black/cases/preview_hug_parens_with_braces_and_square_brackets.py | 1/1 | 49.43% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/preview_import_line_collapse.py | 1/1 | 91.01% | formatter-error: no rule for Try at 540 |
| black/cases/preview_long_dict_values.py | 1/1 | 71.67% | formatter-error: no rule for FunctionDef at 1921 |
| black/cases/preview_long_strings.py | 1/1 | 58.98% | formatter-error: no rule for FunctionDef at 13149 |
| black/cases/preview_long_strings__regression.py | 1/1 | 70.09% | formatter-error: no rule for ClassDef at 0 |
| black/cases/preview_long_strings__type_annotations.py | 1/1 | 62.96% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/preview_multiline_strings.py | 1/1 | 61.57% | formatter-error: no rule for FunctionDef at 1805 |
| black/cases/preview_pep646_typed_star_arg_type_var_tuple.py | 1/1 | 100.00% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/preview_return_annotation_brackets_string.py | 1/1 | 52.63% | formatter-error: no rule for FunctionDef at 22 |
| black/cases/preview_standardize_type_comments.py | 1/1 | 30.00% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/python37.py | 1/1 | 100.00% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/python38.py | 1/1 | 76.47% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/python39.py | 1/1 | 24.00% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/raw_docstring.py | 1/1 | 75.86% | formatter-error: no rule for ClassDef at 0 |
| black/cases/raw_docstring_no_string_normalization.py | 1/1 | 80.00% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/remove_await_parens.py | 1/1 | 61.93% | formatter-error: no rule for FunctionDef at 34 |
| black/cases/remove_except_parens.py | 1/1 | 82.67% | formatter-error: no rule for Try at 50 |
| black/cases/remove_except_types_parens.py | 1/1 | 91.87% | formatter-error: no rule for Try at 51 |
| black/cases/remove_except_types_parens_pre_py314.py | 1/1 | 94.59% | formatter-error: no rule for Try at 51 |
| black/cases/remove_for_brackets.py | 1/1 | 68.18% | formatter-error: no rule for For at 41 |
| black/cases/remove_newline_after_code_block_open.py | 1/1 | 86.01% | formatter-error: no rule for FunctionDef at 16 |
| black/cases/remove_parens.py | 1/1 | 58.57% | formatter-error: no rule for FunctionDef at 149 |
| black/cases/remove_parens_from_lhs.py | 1/1 | 100.00% | formatter-error: unsupported pattern: list_splat_pattern at 203 |
| black/cases/remove_redundant_parens_in_case_guard.py | 1/1 | 85.71% | formatter-error: no rule for Match at 0 |
| black/cases/remove_with_brackets.py | 1/1 | 71.33% | formatter-error: unsupported expression: as_pattern at 93 |
| black/cases/return_annotation_brackets.py | 1/1 | 44.05% | formatter-error: no rule for FunctionDef at 10 |
| black/cases/single_line_format_skip_with_multiple_comments.py | 1/1 | 25.00% | formatter-error: suppression comment at 12 |
| black/cases/skip_magic_trailing_comma_generic_wrap.py | 1/1 | 42.77% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/slices.py | 1/1 | 100.00% | formatter-error: no rule for FunctionDef at 458 |
| black/cases/starred_for_target.py | 1/1 | 100.00% | formatter-error: no rule for For at 0 |
| black/cases/string_prefixes.py | 1/1 | 75.00% | formatter-error: no rule for FunctionDef at 209 |
| black/cases/target_version_flag.py | 1/1 | 57.14% | formatter-error: no rule for ClassDef at 42 |
| black/cases/torture.py | 1/1 | 41.38% | formatter-error: no rule for ClassDef at 330 |
| black/cases/trailing_comma_optional_parens1.py | 1/1 | 67.80% | formatter-error: no rule for If at 0 |
| black/cases/trailing_comma_optional_parens2.py | 1/1 | 22.22% | formatter-error: no rule for If at 0 |
| black/cases/trailing_comma_optional_parens3.py | 1/1 | 100.00% | formatter-error: no rule for If at 0 |
| black/cases/trailing_commas_in_leading_parts.py | 1/1 | 68.35% | formatter-error: no rule for FunctionDef at 296 |
| black/cases/tuple_with_stmt.py | 1/1 | 100.00% | formatter-error: no rule for With at 129 |
| black/cases/type_aliases.py | 1/1 | 24.00% | formatter-error: no rule for ClassDef at 139 |
| black/cases/type_comment_syntax_error.py | 1/1 | 50.00% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/type_expansion.py | 1/1 | 21.82% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/type_param_defaults.py | 1/1 | 29.03% | formatter-error: parse error: ERROR at 7 |
| black/cases/type_params.py | 1/1 | 20.90% | formatter-error: no rule for FunctionDef at 0 |
| black/cases/typed_params_trailing_comma.py | 1/1 | 80.00% | formatter-error: no rule for FunctionDef at 0 |
| black/miscellaneous/blackd_diff.py | 1/1 | 18.18% | formatter-error: no rule for FunctionDef at 0 |
| black/miscellaneous/debug_visitor.py | 1/1 | 81.25% | formatter-error: no rule for ClassDef at 0 |
| black/miscellaneous/force_py36.py | 1/1 | 26.67% | formatter-error: no rule for FunctionDef at 154 |
| ruff/blank_line_before_class_docstring.py | 1/1 | 88.24% | formatter-error: no rule for ClassDef at 0 |
| ruff/docstring.py | 5/5 | 60.89% | formatter-error: no rule for FunctionDef at 0 |
| ruff/docstring_chaperones.py | 1/1 | 88.00% | formatter-error: no rule for FunctionDef at 0 |
| ruff/docstring_code_examples.py | 10/10 | 66.51% | formatter-error: no rule for FunctionDef at 403 |
| ruff/docstring_code_examples_dynamic_line_width.py | 4/4 | 33.66% | formatter-error: no rule for FunctionDef at 0 |
| ruff/docstring_newlines.py | 1/1 | 79.28% | formatter-error: no rule for FunctionDef at 73 |
| ruff/docstring_tab_indentation.py | 2/2 | 74.83% | formatter-error: no rule for FunctionDef at 218 |
| ruff/expression/attribute.py | 1/1 | 71.43% | formatter-error: no rule for If at 2889 |
| ruff/expression/binary.py | 1/1 | 71.58% | formatter-error: no rule for If at 1896 |
| ruff/expression/binary_implicit_string.py | 1/1 | 57.22% | formatter-error: no rule for FunctionDef at 1304 |
| ruff/expression/boolean_operation.py | 1/1 | 85.20% | formatter-error: no rule for If at 0 |
| ruff/expression/bytes.py | 2/2 | 58.69% | formatter-error: no rule for If at 452 |
| ruff/expression/call.py | 1/1 | 73.49% | formatter-error: no rule for FunctionDef at 38 |
| ruff/expression/compare.py | 1/1 | 55.75% | formatter-error: no rule for FunctionDef at 1427 |
| ruff/expression/dict_comp.py | 1/1 | 99.07% | check: output comment "# for  # c  # in  # e" matches no input comment |
| ruff/expression/fstring.py | 2/2 | 57.40% | formatter-error: parse error: ERROR at 21682 |
| ruff/expression/fstring_multiline_replacement_field.py | 2/2 | 62.50% | formatter-error: no rule for If at 0 |
| ruff/expression/if.py | 1/1 | 68.97% | formatter-error: no rule for FunctionDef at 909 |
| ruff/expression/join_implicit_concatenated_string.py | 1/1 | 64.27% | formatter-error: no rule for With at 4861 |
| ruff/expression/lambda.py | 1/1 | 56.13% | formatter-error: no rule for FunctionDef at 935 |
| ruff/expression/list_comp.py | 1/1 | 98.99% | check: output comment "# for  # c  # in  # e" matches no input comment |
| ruff/expression/list_comp_py315.py | 1/1 | 73.53% | formatter-error: parse error: ERROR at 250 |
| ruff/expression/named_expr.py | 1/1 | 81.44% | formatter-error: no rule for If at 7 |
| ruff/expression/nested_string_quote_style.py | 4/4 | 87.50% | check: input "f'\"double\" quotes and {\"nested string with \\\"double\\\" quotes\"}'" at 881 is output as "f'\"double\" |
| ruff/expression/optional_parentheses_comments.py | 1/1 | 76.59% | formatter-error: no rule for FunctionDef at 2963 |
| ruff/expression/set_comp.py | 1/1 | 96.61% | check: output comment "# for  # c  # in  # e" matches no input comment |
| ruff/expression/slice.py | 1/1 | 83.13% | formatter-error: no rule for FunctionDef at 706 |
| ruff/expression/string.py | 2/2 | 59.55% | formatter-error: no rule for If at 568 |
| ruff/expression/tstring.py | 1/1 | 55.30% | formatter-error: parse error: ERROR at 21234 |
| ruff/expression/unary.py | 1/1 | 68.82% | formatter-error: no rule for If at 0 |
| ruff/expression/unsplittable.py | 1/1 | 74.04% | formatter-error: no rule for While at 275 |
| ruff/expression/yield.py | 1/1 | 60.15% | formatter-error: no rule for FunctionDef at 15 |
| ruff/expression/yield_from.py | 1/1 | 60.00% | formatter-error: no rule for FunctionDef at 16 |
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
| ruff/form_feed.py | 1/1 | 83.33% | formatter-error: no rule for If at 69 |
| ruff/newlines.py | 1/1 | 89.65% | formatter-error: suppression comment at 2388 |
| ruff/parentheses/call_chains.py | 1/1 | 81.85% | formatter-error: no rule for If at 2965 |
| ruff/parentheses/expression_parentheses_comments.py | 1/1 | 62.20% | formatter-error: no rule for If at 1388 |
| ruff/parentheses/opening_parentheses_comment_empty.py | 1/1 | 89.39% | formatter-error: no rule for FunctionDef at 284 |
| ruff/parentheses/opening_parentheses_comment_value.py | 1/1 | 56.97% | formatter-error: no rule for FunctionDef at 290 |
| ruff/pattern/pattern_maybe_parenthesize.py | 1/1 | 84.53% | formatter-error: no rule for Match at 123 |
| ruff/pattern_match_regression_brackets.py | 1/1 | 100.00% | formatter-error: no rule for Match at 201 |
| ruff/preview.py | 2/2 | 67.69% | formatter-error: no rule for ClassDef at 98 |
| ruff/quote_style.py | 3/3 | 53.33% | formatter-error: no rule for FunctionDef at 703 |
| ruff/skip_magic_trailing_comma.py | 2/2 | 65.97% | formatter-error: no rule for FunctionDef at 374 |
| ruff/statement/ann_assign.py | 1/1 | 69.77% | formatter-error: no rule for ClassDef at 805 |
| ruff/statement/assert.py | 1/1 | 94.59% | formatter-error: no rule for FunctionDef at 872 |
| ruff/statement/assign.py | 1/1 | 61.04% | formatter-error: no rule for FunctionDef at 996 |
| ruff/statement/break.py | 1/1 | 100.00% | formatter-error: no rule for While at 18 |
| ruff/statement/class_definition.py | 1/1 | 78.26% | formatter-error: no rule for ClassDef at 11 |
| ruff/statement/for.py | 1/1 | 72.37% | formatter-error: no rule for For at 0 |
| ruff/statement/function.py | 1/1 | 66.32% | formatter-error: no rule for FunctionDef at 20 |
| ruff/statement/global.py | 1/1 | 75.68% | formatter-error: no rule for FunctionDef at 0 |
| ruff/statement/if.py | 1/1 | 89.35% | formatter-error: no rule for If at 23 |
| ruff/statement/import.py | 1/1 | 83.15% | formatter-error: no rule for FunctionDef at 899 |
| ruff/statement/long_type_annotations.py | 1/1 | 69.82% | formatter-error: unsupported expression: union_type at 4 |
| ruff/statement/match.py | 1/1 | 71.21% | formatter-error: no rule for Match at 24 |
| ruff/statement/nonlocal.py | 1/1 | 75.68% | formatter-error: no rule for FunctionDef at 0 |
| ruff/statement/return.py | 1/1 | 60.00% | formatter-error: no rule for FunctionDef at 492 |
| ruff/statement/return_annotation.py | 1/1 | 40.08% | formatter-error: no rule for FunctionDef at 47 |
| ruff/statement/return_type_no_parameters.py | 1/1 | 88.14% | formatter-error: no rule for FunctionDef at 597 |
| ruff/statement/return_type_parameters.py | 1/1 | 87.84% | formatter-error: no rule for FunctionDef at 523 |
| ruff/statement/stub_functions_trailing_comments.py | 1/1 | 78.79% | formatter-error: no rule for FunctionDef at 84 |
| ruff/statement/top_level.py | 1/1 | 83.87% | formatter-error: no rule for ClassDef at 0 |
| ruff/statement/try.py | 2/2 | 86.46% | formatter-error: no rule for Try at 0 |
| ruff/statement/while.py | 1/1 | 72.59% | formatter-error: no rule for While at 0 |
| ruff/statement/with.py | 2/2 | 70.13% | formatter-error: unsupported expression: as_pattern at 602 |
| ruff/statement/with_39.py | 1/1 | 71.57% | formatter-error: unsupported expression: as_pattern at 2404 |
| ruff/trivia.py | 1/1 | 93.94% | formatter-error: no rule for ClassDef at 135 |

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
