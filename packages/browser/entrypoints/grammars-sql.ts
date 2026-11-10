import * as sql from "syntechs/grammars/sql";
import * as sqlHighlight from "syntechs/grammars/sql/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/sql": sql,
    "syntechs/grammars/sql/highlight": sqlHighlight,
  });
});
