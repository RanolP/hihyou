import * as markdown from "syntechs/grammars/markdown";
import * as markdownHighlight from "syntechs/grammars/markdown/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/markdown": markdown,
    "syntechs/grammars/markdown/highlight": markdownHighlight,
  });
});
