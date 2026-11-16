import * as toml from "syntechs/grammars/toml";
import * as tomlHighlight from "syntechs/grammars/toml/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/toml": toml,
    "syntechs/grammars/toml/highlight": tomlHighlight,
  });
});
