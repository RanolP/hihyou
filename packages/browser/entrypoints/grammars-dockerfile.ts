import * as dockerfile from "syntechs/grammars/dockerfile";
import * as dockerfileHighlight from "syntechs/grammars/dockerfile/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/dockerfile": dockerfile,
    "syntechs/grammars/dockerfile/highlight": dockerfileHighlight,
  });
});
