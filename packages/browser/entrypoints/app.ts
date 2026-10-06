import type { UnlistedScriptDefinition } from "wxt";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { app } from "../src/app.js";

// Not in the manifest: the background worker injects /app.js into a tab the first time its reviewer turns
// hihyou on, and content.js picks the app up from the isolated world's global (src/app-api.ts).
const definition: UnlistedScriptDefinition = defineUnlistedScript(() => {
  globalThis.hihyouApp = app;
});
export default definition;
