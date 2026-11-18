import * as diff from "syntechs/grammars/diff";
import * as diffHighlight from "syntechs/grammars/diff/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/diff": diff,
    "syntechs/grammars/diff/highlight": diffHighlight,
  });
});
