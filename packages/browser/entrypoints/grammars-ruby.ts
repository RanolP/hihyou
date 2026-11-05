import * as ruby from "syntechs/grammars/ruby";
import * as rubyHighlight from "syntechs/grammars/ruby/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/ruby": ruby,
    "syntechs/grammars/ruby/highlight": rubyHighlight,
  });
});
