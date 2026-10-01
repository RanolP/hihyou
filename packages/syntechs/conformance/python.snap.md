python compatibility: 341/342 (99.71%), 0 refused (ok:false), 34 excluded

Fixtures: ruff 0.16.8 crates/ruff_python_formatter/resources/test/fixtures/{black,ruff} (recursive), every option set of each `.options.json`, expected output from tests/snapshots (black cases without a snapshot: their `.expect` file). Options are passed by their ruff.toml names.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| ruff/notebook_docstring.py | 1/2 | 77.27% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |

# Excluded

## no expected output (2)

- ruff/docstring_code_examples_crlf.py
- ruff/f-string-carriage-return-newline.py

## range formatting (the expected output formats only the range) (32)

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
