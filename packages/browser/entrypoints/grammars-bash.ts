import * as bash from "syntechs/grammars/bash";
import * as bashHighlight from "syntechs/grammars/bash/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/bash": bash,
    "syntechs/grammars/bash/highlight": bashHighlight,
  });
});
