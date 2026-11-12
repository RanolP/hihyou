import * as hcl from "syntechs/grammars/hcl";
import * as hclHighlight from "syntechs/grammars/hcl/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/hcl": hcl,
    "syntechs/grammars/hcl/highlight": hclHighlight,
  });
});
