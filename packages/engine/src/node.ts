// Node-only entry (`@hihyou/engine/node`), kept apart so a browser bundle never pulls in node: modules.
export { nodeGrammarLocator } from "./parse/grammars.node.js";
export { gitVcs } from "./source/git.node.js";
