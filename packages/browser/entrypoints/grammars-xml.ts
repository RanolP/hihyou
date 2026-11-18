import * as xml from "syntechs/grammars/xml";
import * as xmlHighlight from "syntechs/grammars/xml/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/xml": xml,
    "syntechs/grammars/xml/highlight": xmlHighlight,
  });
});
