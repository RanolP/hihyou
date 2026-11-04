# Browser store listing

## Short summary

Review GitHub pull requests with a syntax-aware diff that tracks moved code and what you have viewed.

## Full description

hihyou replaces a GitHub pull request's Files changed tab with a syntax-aware diff, so you review changes node by node instead of as a flat sequence of lines.

It detects moved code, tracks viewed state for individual syntax nodes, and gathers test files behind one row to keep the review focused.

## Category

Developer Tools

## Single purpose

hihyou provides a syntax-aware review view for pull requests on GitHub.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `scripting` | Injects hihyou's own bundled app script into a GitHub pull request tab after the reader enables hihyou. |
| `https://github.com/*` | Runs the review interface on GitHub and reads pull request pages and diffs with the signed-in reader's GitHub session. |
| `https://api.github.com/*` | Reads GitHub pull request metadata and review data. |
| `https://patch-diff.githubusercontent.com/*` | Follows GitHub's redirect when reading a pull request diff. |
| `https://raw.githubusercontent.com/*` | Follows GitHub's redirect when reading file contents. |

## Data usage

hihyou does not collect personal data or any other user data.

hihyou has no analytics, telemetry, or server of its own, and it does not sell, transfer, or use user data for purposes unrelated to its single purpose.

## Privacy policy URL

https://github.com/RanolP/hihyou/blob/main/docs/privacy.md
