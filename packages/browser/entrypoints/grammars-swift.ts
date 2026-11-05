import * as swift from "syntechs/grammars/swift";
import * as swiftFmt from "syntechs/grammars/swift/fmt";
import * as swiftHighlight from "syntechs/grammars/swift/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/swift": swift,
    "syntechs/grammars/swift/fmt": swiftFmt,
    "syntechs/grammars/swift/highlight": swiftHighlight,
  });
});
