import * as kotlin from "syntechs/grammars/kotlin";
import * as kotlinFmt from "syntechs/grammars/kotlin/fmt";
import * as kotlinHighlight from "syntechs/grammars/kotlin/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/kotlin": kotlin,
    "syntechs/grammars/kotlin/fmt": kotlinFmt,
    "syntechs/grammars/kotlin/highlight": kotlinHighlight,
  });
});
