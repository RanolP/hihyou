import * as ini from "syntechs/grammars/ini";
import * as iniHighlight from "syntechs/grammars/ini/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/ini": ini,
    "syntechs/grammars/ini/highlight": iniHighlight,
  });
});
