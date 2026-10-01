// TextMate scopes for the JavaScript family (javascript, typescript, tsx), named after the scopes VS Code's
// TypeScript grammar assigns, so a theme colours a node the way it colours the same token in VS Code. The
// tree decides what the grammar guesses from text: a call's callee, a declaration's kind, a parameter.

import type { Tree } from "../../core/index.js";
import type { HighlightModule, Paint } from "../../highlight/index.js";

const OPERATOR = "keyword.operator.js";
const NONE = "";

/** Anonymous tokens by their text. Punctuation left out (brackets, `,`, `;`, `.`) carries no scope. */
const TOKEN: Record<string, string> = {
  "=>": "storage.type.function.arrow.js",
  "...": "keyword.operator.spread.js",
  "?.": "punctuation.accessor.optional.js",
  ".": NONE,
  "@": "punctuation.decorator.js",
  "${": "punctuation.definition.template-expression.begin.js",
};
for (const op of [
  "=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "&&=", "||=", "??=",
  "==", "===", "!=", "!==", "<", ">", "<=", ">=", "+", "-", "*", "/", "%", "**", "++", "--", "<<", ">>",
  ">>>", "&", "|", "^", "~", "!", "&&", "||", "??", "?", ":", "-?:", "+?:", "?:", "-?", "+?",
])
  TOKEN[op] = OPERATOR;

/** Keywords that are values. */
const LANGUAGE_CONSTANT = new Set(["true", "false", "null", "undefined"]);

/** Type keywords inside `predefined_type`. */
const PRIMITIVE_TYPE = "support.type.primitive.ts";

/** Globals VS Code's grammar names by their text wherever they appear as a value. */
const SUPPORT: Record<string, string> = {
  module: "support.type.object.module.js",
  exports: "support.type.object.module.js",
  Promise: "support.class.promise.js",
};

/** Properties VS Code's grammar colours as support variables after any `.`. */
const SUPPORT_PROPERTY = new Set(["length", "prototype", "constructor"]);

const CONSTANT = /^#?[A-Z][_$\dA-Z]*$/;

const IDENTIFIER = new Set([
  "identifier",
  "property_identifier",
  "shorthand_property_identifier",
  "shorthand_property_identifier_pattern",
  "private_property_identifier",
  "type_identifier",
  "statement_identifier",
]);

const FUNCTION_VALUE = new Set([
  "arrow_function",
  "function_expression",
  "function",
  "generator_function",
]);

class Walker {
  constructor(
    private readonly tree: Tree,
    private readonly paint: Paint,
  ) {}

  /** `decl`: the identifiers here are bound by a `const` (1) or a parameter (2) declaration. */
  visit(n: number, decl: number): void {
    const tree = this.tree;
    const kind = tree.kindName(n);
    const count = tree.count(n);
    if (!tree.named(n)) {
      if (count === 0) this.token(n, kind);
      return;
    }
    switch (kind) {
      case "comment":
        this.comment(n);
        return;
      case "hash_bang_line":
        this.paint(n, "comment.line.shebang.js");
        return;
      case "string":
        this.paint(n, tree.text(n).startsWith('"') ? "string.quoted.double.js" : "string.quoted.single.js");
        break;
      case "template_string":
        this.paint(n, "string.template.js");
        break;
      case "template_substitution":
        this.paint(n, "meta.template.expression.js");
        break;
      case "escape_sequence":
        this.paint(n, "constant.character.escape.js");
        return;
      case "regex":
        this.paint(n, "string.regexp.js");
        break;
      case "regex_flags":
        this.paint(n, "keyword.other.js");
        return;
      case "number":
        this.paint(n, "constant.numeric.js");
        return;
      case "true":
      case "false":
      case "null":
      case "undefined":
        this.paint(n, "constant.language.js");
        return;
      case "this":
      case "super":
        this.paint(n, `variable.language.${kind}.js`);
        return;
      case "this_type":
        this.paint(n, "variable.language.this.js");
        return;
      case "meta_property":
        for (let i = 0; i < count; i++) {
          const c = tree.child(n, i);
          const t = tree.text(c);
          if (t === "meta" || t === "target") this.paint(c, `support.variable.property.${t}.js`);
          else if (t !== ".") this.paint(c, "keyword.control.js");
        }
        return;
      case "regex_pattern":
        this.regexPattern(n);
        return;
      case "predefined_type":
        this.paint(n, PRIMITIVE_TYPE);
        return;
      case "lexical_declaration":
      case "using_declaration":
      case "variable_declaration":
      case "for_in_statement": {
        const k = tree.child(n, 0);
        const isConst =
          kind === "for_in_statement" ? this.forConst(n) : kind === "using_declaration" || tree.text(k) === "const";
        this.children(n, isConst ? 1 : 0);
        return;
      }
      case "variable_declarator":
        this.declarator(n, decl);
        return;
      case "required_parameter":
      case "optional_parameter":
        this.parameter(n);
        return;
      case "formal_parameters":
        this.children(n, 2);
        return;
      case "arrow_function": {
        for (let i = 0; i < count; i++) {
          const c = tree.child(n, i);
          this.visit(c, tree.fieldName(c) === "parameter" ? 2 : 0);
        }
        return;
      }
      case "jsx_opening_element":
      case "jsx_closing_element":
      case "jsx_self_closing_element":
        this.jsxElement(n);
        return;
      case "jsx_text":
        return;
      case "import":
        this.paint(n, "keyword.control.js");
        return;
      default:
        if (IDENTIFIER.has(kind) || kind === "nested_identifier") {
          if (count === 0) this.identifier(n, kind, decl);
          else this.children(n, decl);
          return;
        }
    }
    // Patterns keep the binding kind; anything else (a default value, a computed key) is an expression.
    const keep = kind.endsWith("_pattern") || kind === "pair_pattern" ? decl : 0;
    this.children(n, keep);
  }

  private children(n: number, decl: number): void {
    const tree = this.tree;
    for (let i = 0, count = tree.count(n); i < count; i++) {
      const c = tree.child(n, i);
      // In `{ a: b = 1 }` only the value binds; the key and the default are not bindings.
      if (decl !== 0 && (tree.fieldName(c) === "key" || tree.fieldName(c) === "right"))
        this.visit(c, 0);
      else this.visit(c, decl);
    }
  }

  private forConst(n: number): boolean {
    const tree = this.tree;
    for (let i = 0, count = tree.count(n); i < count; i++) {
      const c = tree.child(n, i);
      if (tree.fieldName(c) === "kind") return tree.text(c) === "const";
    }
    return false;
  }

  private declarator(n: number, decl: number): void {
    const tree = this.tree;
    let value = -1;
    for (let i = 0, count = tree.count(n); i < count; i++) {
      const c = tree.child(n, i);
      if (tree.fieldName(c) === "value") value = c;
    }
    for (let i = 0, count = tree.count(n); i < count; i++) {
      const c = tree.child(n, i);
      if (tree.fieldName(c) === "name" && tree.count(c) === 0 && tree.kindName(c) === "identifier") {
        if ((value >= 0 && FUNCTION_VALUE.has(tree.kindName(value))) || this.callableMember(n))
          this.paint(c, "entity.name.function.js");
        else this.paint(c, decl === 1 || CONSTANT.test(tree.text(c)) ? "variable.other.constant.js" : "variable.other.readwrite.js");
      } else this.visit(c, tree.fieldName(c) === "name" ? decl : 0);
    }
  }

  /** A TypeScript parameter: a callable type annotation makes it read as a function. */
  private parameter(n: number): void {
    const tree = this.tree;
    let callable = false;
    for (let i = 0, count = tree.count(n); i < count; i++) {
      const c = tree.child(n, i);
      if (tree.fieldName(c) !== "type") continue;
      const t = tree.count(c) > 1 ? tree.child(c, 1) : -1;
      callable = t >= 0 && tree.kindName(t) === "function_type";
    }
    for (let i = 0, count = tree.count(n); i < count; i++) {
      const c = tree.child(n, i);
      if (tree.fieldName(c) === "pattern" && tree.count(c) === 0 && tree.kindName(c) === "identifier")
        this.paint(c, callable ? "entity.name.function.js" : "variable.parameter.js");
      else this.visit(c, tree.fieldName(c) === "pattern" ? 2 : 0);
    }
  }

  private identifier(n: number, kind: string, decl: number): void {
    const tree = this.tree;
    const p = tree.parent(n);
    const pk = tree.kindName(p);
    const field = tree.fieldName(n);
    const text = tree.text(n);
    const paint = this.paint;

    if (kind === "type_identifier") {
      paint(n, "entity.name.type.js");
      return;
    }
    if (kind === "statement_identifier") {
      paint(n, "entity.name.label.js");
      return;
    }
    if (pk === "call_expression" && field === "function") {
      paint(n, SUPPORT[text] ?? "entity.name.function.js");
      return;
    }
    if (pk === "member_expression" && field === "property") {
      // `a.b!(...)` still calls `b`.
      const callee = tree.kindName(tree.parent(p)) === "non_null_expression" ? tree.parent(p) : p;
      const gp = tree.parent(p);
      if (text === "exports" && tree.text(tree.child(p, 0)) === "module") paint(n, SUPPORT.exports as string);
      else if (
        (tree.kindName(tree.parent(callee)) === "call_expression" && tree.fieldName(callee) === "function") ||
        (tree.kindName(gp) === "assignment_expression" && tree.fieldName(p) === "left" && this.functionValue(gp, "right"))
      )
        paint(n, "entity.name.function.js");
      else if (CONSTANT.test(text)) paint(n, "variable.other.constant.property.js");
      else if (SUPPORT_PROPERTY.has(text)) paint(n, "support.variable.property.js");
      else paint(n, "variable.other.property.js");
      return;
    }
    if (decl === 2) {
      paint(n, "variable.parameter.js");
      return;
    }
    if (decl === 1) {
      paint(n, "variable.other.constant.js");
      return;
    }
    switch (pk) {
      case "new_expression":
        if (field === "constructor") {
          paint(n, SUPPORT[text] ?? "entity.name.function.js");
          return;
        }
        break;
      case "binary_expression":
        if (field === "right" && tree.text(tree.child(p, 1)) === "instanceof") {
          paint(n, "entity.name.type.js");
          return;
        }
        break;
      case "assignment_expression":
        if (field === "left" && this.functionValue(p, "right")) {
          paint(n, "entity.name.function.js");
          return;
        }
        break;
      case "nested_type_identifier":
      case "nested_identifier":
        if (field === "module" || tree.child(p, 0) === n) {
          paint(n, "entity.name.type.module.js");
          return;
        }
        break;
      case "extends_clause":
      case "class_heritage":
        paint(n, "entity.other.inherited-class.js");
        return;
      case "pair_pattern":
        if (field === "key") {
          paint(n, "variable.object.property.js");
          return;
        }
        break;
      case "type_predicate":
        if (field === "name") {
          paint(n, "variable.parameter.js");
          return;
        }
        break;
      case "function_declaration":
      case "generator_function_declaration":
      case "function_expression":
      case "generator_function":
      case "function_signature":
      case "method_definition":
      case "method_signature":
      case "abstract_method_signature":
        if (field === "name") {
          paint(n, text === "constructor" ? "storage.type.js" : "entity.name.function.js");
          return;
        }
        break;
      case "class_declaration":
      case "class":
      case "abstract_class_declaration":
        if (field === "name") {
          paint(n, "entity.name.type.class.js");
          return;
        }
        break;
      case "pair":
        if (field === "key") {
          paint(n, this.functionValue(p, "value") ? "entity.name.function.js" : "meta.object-literal.key.js");
          return;
        }
        break;
      case "property_signature":
      case "public_field_definition":
      case "field_definition":
        if (field === "name" || field === "property") {
          paint(n, this.callableMember(p) ? "entity.name.function.js" : "variable.object.property.js");
          return;
        }
        break;
      case "enum_body":
      case "enum_assignment":
        paint(n, "variable.other.enummember.js");
        return;
      case "decorator":
        paint(n, "entity.name.function.decorator.js");
        return;
      case "jsx_attribute":
        paint(n, "entity.other.attribute-name.js");
        return;
      case "import_specifier":
      case "import_clause":
      case "namespace_import":
      case "export_specifier":
        paint(n, "variable.other.readwrite.alias.js");
        return;
      case "member_expression":
        paint(n, SUPPORT[text] ?? (CONSTANT.test(text) ? "variable.other.constant.object.js" : "variable.other.object.js"));
        return;
    }
    if (kind === "property_identifier") {
      paint(n, "variable.other.property.js");
      return;
    }
    paint(n, SUPPORT[text] ?? (CONSTANT.test(text) ? "variable.other.constant.js" : "variable.other.readwrite.js"));
  }

  /** Whether `n`'s child in `field` is a function expression. */
  private functionValue(n: number, field: string): boolean {
    const tree = this.tree;
    for (let i = 0, count = tree.count(n); i < count; i++) {
      const c = tree.child(n, i);
      if (tree.fieldName(c) === field) return FUNCTION_VALUE.has(tree.kindName(c));
    }
    return false;
  }

  /** A property signature or field whose type or value is a function. */
  private callableMember(n: number): boolean {
    const tree = this.tree;
    for (let i = 0, count = tree.count(n); i < count; i++) {
      const c = tree.child(n, i);
      const f = tree.fieldName(c);
      if (f === "value" && FUNCTION_VALUE.has(tree.kindName(c))) return true;
      if (f === "type") {
        const t = tree.count(c) > 1 ? tree.child(c, 1) : -1;
        if (t >= 0 && tree.kindName(t) === "function_type") return true;
      }
    }
    return false;
  }

  private jsxElement(n: number): void {
    const tree = this.tree;
    for (let i = 0, count = tree.count(n); i < count; i++) {
      const c = tree.child(n, i);
      if (tree.fieldName(c) === "name") {
        const text = tree.text(c);
        const first = text.charCodeAt(0);
        const component = (first >= 65 && first <= 90) || text.includes(".");
        this.paint(c, component ? "support.class.component.js" : "entity.name.tag.js");
      } else if (tree.named(c)) this.visit(c, 0);
    }
  }

  private token(n: number, text: string): void {
    const tree = this.tree;
    const pk = tree.kindName(tree.parent(n));
    const scope = TOKEN[text];
    if (scope !== undefined) {
      if (scope === NONE) return;
      // Punctuation that is an operator only in some places.
      switch (text) {
        case ":":
          if (pk !== "ternary_expression" && pk !== "conditional_type" && pk !== "index_signature" && !pk.endsWith("annotation")) return;
          break;
        case "<":
        case ">":
          if (pk === "type_arguments" || pk === "type_parameters") return;
          break;
        case "*":
          if (pk === "namespace_import" || pk === "export_statement") {
            this.paint(n, "constant.language.import-export-all.js");
            return;
          }
          break;
        case "/":
          if (pk === "regex") {
            this.paint(n, "punctuation.definition.string.regexp.js");
            return;
          }
          break;
      }
      this.paint(n, scope);
      return;
    }
    const c = text.charCodeAt(0);
    if (!((c >= 97 && c <= 122) || (c >= 65 && c <= 90))) return;
    if (pk === "predefined_type") this.paint(n, PRIMITIVE_TYPE);
    else if (text === "import" && pk === "call_expression") this.paint(n, "entity.name.function.js");
    else if (LANGUAGE_CONSTANT.has(text)) this.paint(n, "constant.language.js");
    else this.paint(n, "keyword.control.js");
  }

  private regexPattern(n: number): void {
    regexScopes(this.tree.text(n), (scope, from, to) => this.paint(n, scope, from, to));
  }

  private comment(n: number): void {
    const tree = this.tree;
    const text = tree.text(n);
    if (!text.startsWith("/**") || text === "/**/") {
      this.paint(n, text.startsWith("//") ? "comment.line.double-slash.js" : "comment.block.js");
      return;
    }
    this.paint(n, "comment.block.documentation.js");
    // JSDoc: `@tag`, then `{type}`, then for a parameter tag its name.
    const tag = /@([a-zA-Z]+)(?![\w/])/g;
    for (let m = tag.exec(text); m !== null; m = tag.exec(text)) {
      if (m.index > 0 && /[\w`]/.test(text[m.index - 1] as string)) continue;
      const tagName = m[1] as string;
      let at = m.index + 1 + tagName.length;
      this.paint(n, "storage.type.class.jsdoc", m.index, at);
      if (tagName === "default" || tagName === "defaultValue") {
        // The value is the first word after the tag, whatever it is, even a `{`.
        const value = /[ \t]+([^\s*]+|\*(?!\/))/y;
        value.lastIndex = at;
        const v = value.exec(text);
        if (v) this.paint(n, "variable.other.jsdoc", value.lastIndex - (v[1] as string).length, value.lastIndex);
        continue;
      }
      const type = /[ \t]+\{[^}\n]*\}/y;
      type.lastIndex = at;
      if (type.exec(text)) {
        const open = text.indexOf("{", at);
        this.paint(n, "entity.name.type.instance.jsdoc", open, type.lastIndex);
        at = type.lastIndex;
      }
      const name = /[ \t]+(\[?[\w$.]+)/y;
      name.lastIndex = at;
      const param = name.exec(text)?.[1];
      if (param !== undefined && /^(param|arg|argument|property|prop)$/.test(tagName)) {
        this.paint(n, "variable.other.jsdoc", name.lastIndex - param.length, name.lastIndex);
      } else if (/^(see|link|linkcode|linkplain)$/.test(tagName)) {
        const link = /[ \t]+([^\s}|]+)/y;
        link.lastIndex = at;
        const l = link.exec(text);
        if (l) this.paint(n, "variable.other.link.underline.jsdoc", link.lastIndex - (l[1] as string).length, link.lastIndex);
      }
    }
  }
}

/**
 * The inside of a regex literal as VS Code's regexp grammar splits it: anchors, quantifiers and `|` as
 * keywords, character classes and `.` as constants, backslash escapes as escapes.
 */
function regexScopes(text: string, emit: (scope: string, from: number, to: number) => void): void {
  const n = text.length;
  let i = 0;
  let lastAtom = false;
  while (i < n) {
    const c = text[i] as string;
    const s = i;
    if (c === "\\") {
      const d = text[i + 1] ?? "";
      if (/[dDwWsS]/.test(d)) emit("constant.other.character-class.regexp", s, (i += 2));
      else if (d === "b" || d === "B") emit("keyword.control.anchor.regexp", s, (i += 2));
      else if (/[1-9]/.test(d)) {
        i += 2;
        while (i < n && /\d/.test(text[i] as string)) i++;
        emit("keyword.other.back-reference.regexp", s, i);
      } else if (d === "k" && text[i + 2] === "<") {
        i = text.indexOf(">", i) + 1 || n;
        emit("keyword.other.back-reference.regexp", s, i);
      } else if (d === "p" || d === "P") {
        i = text[i + 2] === "{" ? text.indexOf("}", i) + 1 || n : i + 2;
        emit("constant.other.character-class.regexp", s, i);
      } else {
        i += d === "u" && text[i + 2] === "{" ? text.indexOf("}", i) + 1 - i || 2 : d === "u" ? 6 : d === "x" ? 4 : d === "c" ? 3 : 2;
        i = Math.min(i, n);
        emit("constant.character.escape.backslash.regexp", s, i);
      }
      lastAtom = true;
    } else if (c === "[") {
      // VS Code colours a whole class, escapes included, as the set; only a negating `^` stands out.
      i++;
      while (i < n && text[i] !== "]") i += text[i] === "\\" ? 2 : 1;
      i = Math.min(n, i + 1);
      emit("constant.other.character-class.set.regexp", s, i);
      if (text[s + 1] === "^") emit("keyword.operator.negation.regexp", s + 1, s + 2);
      lastAtom = true;
    } else if (c === "^" || c === "$") {
      emit("keyword.control.anchor.regexp", s, ++i);
      lastAtom = false;
    } else if (c === "|") {
      emit("keyword.operator.or.regexp", s, ++i);
      lastAtom = false;
    } else if ((c === "*" || c === "+" || c === "?") && lastAtom) {
      i++;
      if (text[i] === "?") i++;
      emit("keyword.operator.quantifier.regexp", s, i);
      lastAtom = false;
    } else if (c === "{" && /^\{\d+(,\d*)?\}/.test(text.slice(i, i + 12))) {
      i = text.indexOf("}", i) + 1;
      if (text[i] === "?") i++;
      emit("keyword.operator.quantifier.regexp", s, i);
      lastAtom = false;
    } else if (c === "(") {
      i++;
      const named = /^\?<([A-Za-z_$][\w$]*)>/.exec(text.slice(i, i + 64));
      if (named) {
        emit("variable.other.regexp", i + 2, i + 2 + (named[1] as string).length);
        i += named[0].length;
      } else if (text[i] === "?") i += text[i + 1] === "<" ? 3 : 2;
      lastAtom = false;
    } else if (c === ".") {
      emit("constant.other.character-class.regexp", s, ++i);
      lastAtom = true;
    } else {
      i++;
      lastAtom = true;
    }
  }
}

export const highlight: HighlightModule = {
  highlight(tree, paint) {
    new Walker(tree, paint).visit(tree.root, 0);
  },
};
