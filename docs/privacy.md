# hihyou privacy policy

hihyou collects no personal data and has no analytics, telemetry, or server of its own.

hihyou runs only on `github.com`.

Its background worker fetches only GitHub origins—`github.com`, `api.github.com`, `patch-diff.githubusercontent.com`, and `raw.githubusercontent.com`—to read a pull request's diff and file contents.

These requests send the browser's own `github.com` cookies so private repositories work for the signed-in user.

hihyou sends nothing anywhere else.

hihyou stores the reader's viewed-file state and view mode in `github.com`'s `localStorage` in that browser only.

hihyou stores whether the extension is enabled in the browser's extension storage. A temporary switch to GitHub's view is stored for that pull request in that tab's `sessionStorage`.

The `scripting` permission is used only to inject hihyou's own bundled app script into the GitHub tab.

The `storage` permission is used only to remember whether hihyou is enabled.

For privacy questions, open an issue at https://github.com/RanolP/hihyou/issues.
