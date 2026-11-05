import * as go from "syntechs/grammars/go";
import * as goHighlight from "syntechs/grammars/go/highlight";
import * as graphql from "syntechs/grammars/graphql";
import * as graphqlFmt from "syntechs/grammars/graphql/fmt";
import * as graphqlHighlight from "syntechs/grammars/graphql/highlight";
import * as python from "syntechs/grammars/python";
import * as pythonFmt from "syntechs/grammars/python/fmt";
import * as pythonHighlight from "syntechs/grammars/python/highlight";
import * as rust from "syntechs/grammars/rust";
import * as rustHighlight from "syntechs/grammars/rust/highlight";
import * as yaml from "syntechs/grammars/yaml";
import * as yamlFmt from "syntechs/grammars/yaml/fmt";
import * as yamlHighlight from "syntechs/grammars/yaml/highlight";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerGrammarModules } from "../src/grammar-registry.js";

export default defineUnlistedScript(() => {
  registerGrammarModules({
    "syntechs/grammars/go": go,
    "syntechs/grammars/go/highlight": goHighlight,
    "syntechs/grammars/graphql": graphql,
    "syntechs/grammars/graphql/fmt": graphqlFmt,
    "syntechs/grammars/graphql/highlight": graphqlHighlight,
    "syntechs/grammars/python": python,
    "syntechs/grammars/python/fmt": pythonFmt,
    "syntechs/grammars/python/highlight": pythonHighlight,
    "syntechs/grammars/rust": rust,
    "syntechs/grammars/rust/highlight": rustHighlight,
    "syntechs/grammars/yaml": yaml,
    "syntechs/grammars/yaml/fmt": yamlFmt,
    "syntechs/grammars/yaml/highlight": yamlHighlight,
  });
});
