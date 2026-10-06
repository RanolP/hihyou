# hihyou userscript

hihyou replaces a GitHub pull request's **Files changed** tab with its syntax-aware diff. Until the browser extension passes store review, the same code ships here as a userscript, which Tampermonkey or Violentmonkey runs on github.com. Once the extension is in the stores, install that instead and remove the userscript.

## Install

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. In Chrome, Edge and other Chromium browsers, let the manager run userscripts: open the browser's extensions page, choose **Details** on the manager, and turn on **Allow User Scripts**. Chromium requires this for every userscript manager; without it the script installs but never runs.
3. Open [hihyou.user.js](https://ranolp.github.io/hihyou/hihyou.user.js). The manager shows the script and the permissions it asks for; confirm the install.
4. Open a pull request's **Files changed** tab on github.com and press the **hihyou** button above the diff.

The manager checks this site for a newer version and updates the script on its own schedule.

## What it can do

- It runs on `https://github.com/*`, because GitHub moves between pages without reloading and the script has to be running when you reach a pull request.
- It reads `.diff` and raw files with your github.com session, so private repositories work for whoever is signed in. It sends requests only to `https://github.com/` URLs, and the manager lets them follow GitHub's redirects to `patch-diff.githubusercontent.com` and `raw.githubusercontent.com` and nowhere else.
- Everything it runs is inside the one file you install; it loads no code from anywhere at run time.

## Caveats

- This is a stopgap until the store version, and it is built from the same source.
- Userscript managers keep a script's code and data unencrypted in the browser profile, as they do for every userscript.
- hihyou remembers only whether it was on, in github.com's local storage.
