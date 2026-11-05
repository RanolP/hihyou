import * as css from "syntechs/grammars/css";
import * as cssFmt from "syntechs/grammars/css/fmt";
import * as cssHighlight from "syntechs/grammars/css/highlight";
import * as html from "syntechs/grammars/html";
import * as htmlFmt from "syntechs/grammars/html/fmt";
import * as htmlHighlight from "syntechs/grammars/html/highlight";
import * as javascript from "syntechs/grammars/javascript";
import * as javascriptFmt from "syntechs/grammars/javascript/fmt";
import * as javascriptHighlight from "syntechs/grammars/javascript/highlight";
import * as json from "syntechs/grammars/json";
import * as jsonHighlight from "syntechs/grammars/json/highlight";
import * as tsx from "syntechs/grammars/tsx";
import * as tsxHighlight from "syntechs/grammars/tsx/highlight";
import * as typescript from "syntechs/grammars/typescript";
import * as typescriptFmt from "syntechs/grammars/typescript/fmt";
import * as typescriptHighlight from "syntechs/grammars/typescript/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

// HTML formatting embeds CSS, JavaScript, JSON, TSX, and TypeScript, so the web grammars share one chunk.
export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/css": css,
    "syntechs/grammars/css/fmt": cssFmt,
    "syntechs/grammars/css/highlight": cssHighlight,
    "syntechs/grammars/html": html,
    "syntechs/grammars/html/fmt": htmlFmt,
    "syntechs/grammars/html/highlight": htmlHighlight,
    "syntechs/grammars/javascript": javascript,
    "syntechs/grammars/javascript/fmt": javascriptFmt,
    "syntechs/grammars/javascript/highlight": javascriptHighlight,
    "syntechs/grammars/json": json,
    "syntechs/grammars/json/highlight": jsonHighlight,
    "syntechs/grammars/tsx": tsx,
    "syntechs/grammars/tsx/highlight": tsxHighlight,
    "syntechs/grammars/typescript": typescript,
    "syntechs/grammars/typescript/fmt": typescriptFmt,
    "syntechs/grammars/typescript/highlight": typescriptHighlight,
  });
});
