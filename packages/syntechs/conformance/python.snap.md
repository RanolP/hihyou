python compatibility: 302/327 (92.35%), 5 refused (ok:false), 49 excluded

Fixtures: ruff 0.16.8 crates/ruff_python_formatter/resources/test/fixtures/{black,ruff} (recursive), every option set of each `.options.json`, expected output from tests/snapshots (black cases without a snapshot: their `.expect` file). Options are passed by their ruff.toml names.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| black/cases/attribute_access_on_number_literals.py | 0/1 | 90.91% |
| black/cases/comments_in_blocks.py | 0/1 | 98.68% |
| black/cases/comments_non_breaking_space.py | 0/1 | 86.96% |
| black/cases/expression.py | 0/1 | 54.95% |
| black/cases/fmtskip10.py | 0/1 | 94.12% |
| black/cases/import_comments.py | 0/1 | 84.44% |
| black/cases/preview_hug_parens_with_braces_and_square_brackets.py | 0/1 | 48.53% |
| black/cases/preview_hug_parens_with_braces_and_square_brackets_no_ll1.py | 0/1 | 37.61% |
| black/cases/preview_import_line_collapse.py | 0/1 | 99.43% |
| black/cases/preview_long_dict_values.py | 0/1 | 90.30% |
| black/cases/preview_long_strings__regression.py | 0/1 | 97.13% |
| ruff/expression/binary_implicit_string.py | 0/1 | 98.52% |
| ruff/expression/call.py | 0/1 | 99.08% |
| ruff/expression/compare.py | 0/1 | 98.68% |
| ruff/expression/join_implicit_concatenated_string.py | 0/1 | 98.70% |
| ruff/expression/join_implicit_concatenated_string_preserve.py | 1/2 | 95.45% |
| ruff/expression/slice.py | 0/1 | 94.07% |
| ruff/statement/function.py | 0/1 | 99.60% |
| ruff/statement/lazy_import.py | 0/1 | 68.97% |
| ruff/trailing_comments.py | 0/1 | 86.11% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| black/cases/pattern_matching_style.py | 1/1 | 46.81% | formatter-error: unsupported pattern comment at 498 |
| black/cases/remove_for_brackets.py | 1/1 | 96.00% | check: input "(" at 672 is output as "k" at 692, which means "k", not "(" |
| ruff/expression/lambda.py | 1/1 | 99.11% | check: input comment "# 2" is missing from the output |
| ruff/expression/list_comp_py315.py | 1/1 | 73.53% | formatter-error: parse error: ERROR at 250 |
| ruff/statement/match.py | 1/1 | 71.21% | formatter-error: comment in a pattern at 2288 |

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
