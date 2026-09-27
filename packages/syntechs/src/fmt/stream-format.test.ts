import { describe, expect, it } from "vitest";
import { parseTree } from "../core/index.js";
import { json } from "../grammars/json/fmt.js";
import { language as jsonParser } from "../grammars/json/index.js";
import { format } from "./format.js";
import type { PrintArgs } from "./rules.js";
import { closeSpan, openSpan, sJump, sText, sToken } from "./stream.js";
import {
  printLeadingComments,
  printTrailingComments,
  type StreamCtx,
  type StreamRule,
  type StreamRules,
} from "./stream-format.js";
import { printKid } from "./dsl/runtime.js";

// JSON's stream language with `hooks` over its rules, as a language moving off Docs (JS) declares them.
type Rules = StreamRules<typeof json.defaults>;
const withHooks = (hooks: Partial<Rules>, rules: Record<string, StreamRule> = {}) => {
  const base = json.stream as Rules;
  const merged = new Map(base.rules);
  for (const [k, r] of Object.entries(rules)) merged.set(k, r);
  return { ...json, stream: { ...base, ...hooks, rules: merged } };
};

const run = (language: ReturnType<typeof withHooks>, text: string) => {
  const out = format(parseTree(jsonParser, text), language);
  if (!out.ok) throw new Error(out.detail);
  return out.text;
};

const numberText: StreamRule = (node, ctx) => sToken(node, ctx.tree.text(node));

describe("formatStream's hooks let a language print as prettier's printer hooks do", () => {
  it("prints each comment through printComment, so a respelled comment is not printed as its source", () => {
    const lang = withHooks({
      printComment: (c, ctx) => sToken(c, ctx.tree.text(c).toUpperCase()),
    });
    expect(run(lang, "[/* c */ 1]")).toBe("[/* C */ 1]\n");
  });

  it("leaves a node's comments to its rule when printsOwnComments says so, printing them once, inside", () => {
    const lang = withHooks(
      { printsOwnComments: (node, ctx) => ctx.tree.kindName(node) === "number" },
      {
        number: (node, ctx) => {
          sText("(");
          printLeadingComments(ctx, node);
          sToken(node, ctx.tree.text(node));
          printTrailingComments(ctx, node);
          sText(")");
        },
      },
    );
    expect(run(lang, "[/* c */ 1]")).toBe("[(/* c */ 1)]\n");
  });

  // A custom that printed its kid between the kid's comments printed a comment-owning kid's comments twice.
  it("leaves a comment-owning kid's comments to its rule when a custom prints the kid", () => {
    const lang = withHooks(
      { printsOwnComments: (node: number, ctx: StreamCtx) => ctx.tree.kindName(node) === "number" },
      {
        number: (node, ctx) => {
          sText("(");
          printLeadingComments(ctx, node);
          sToken(node, ctx.tree.text(node));
          printTrailingComments(ctx, node);
          sText(")");
        },
        array: (node, ctx) => {
          for (let i = 0, count = ctx.tree.count(node); i < count; i++) {
            const c = ctx.tree.child(node, i);
            if (ctx.tree.kindName(c) !== "comment") printKid(ctx, c);
          }
        },
      },
    );
    expect(run(lang, "[/* c */ 1]")).toBe("[(/* c */ 1)]\n");
  });

  it("wraps a node's rule inside its comments, as prettier's parentheses go inside them", () => {
    const lang = withHooks({
      wrap: (node, ctx, print) => {
        const paren = ctx.tree.kindName(node) === "number";
        if (paren) sText("(");
        print();
        if (paren) sText(")");
      },
    });
    expect(run(lang, "[/* c */ 1]")).toBe("[/* c */ (1)]\n");
  });

  it("prints a node its wrap ignores as its source text instead of by its rule, as prettier-ignore does", () => {
    const lang = withHooks({
      wrap: (node, ctx, print) => {
        const ignored = ctx
          .leadingComments(node)
          .some((c) => ctx.tree.text(c).includes("prettier-ignore"));
        if (ignored) sToken(node, ctx.tree.text(node));
        else print();
      },
    });
    expect(run(lang, "[/* prettier-ignore */ 1.50, 2.50]")).toBe(
      "[/* prettier-ignore */ 1.50, 2.5]\n",
    );
  });

  it("prints a node printed again by a jump to its first print's span, running its rule once", () => {
    let runs = 0;
    const spans = new Map<number, number>();
    const lang = withHooks(
      {
        wrap: (node, _ctx, print, args) => {
          const t = args === undefined ? spans.get(node) : undefined;
          if (t !== undefined) return sJump(t);
          if (args !== undefined) return print();
          const s = openSpan();
          print();
          closeSpan();
          spans.set(node, s);
        },
      },
      {
        number: (node, ctx) => {
          runs++;
          numberText(node, ctx);
        },
        pair: (node, ctx) => {
          const value = ctx.items(node)[1] as number;
          ctx.print(value);
          sText(" ");
          ctx.print(value);
        },
      },
    );
    expect(run(lang, '{"a": 10}')).toBe("{ 10 10 }\n");
    expect(runs).toBe(1);
  });

  it("passes a rule's args to the rule of the child it prints, and to the wrap around it, but no further", () => {
    const seen: (PrintArgs | undefined)[] = [];
    const lang = withHooks(
      {
        wrap: (_node, _ctx, print, args) => {
          seen.push(args);
          print();
        },
      },
      {
        number: (node, ctx) => sToken(node, `${ctx.args?.["tag"] ?? ""}${ctx.tree.text(node)}`),
        pair: (node, ctx) => ctx.print(ctx.items(node)[1] as number, { tag: "!" }),
      },
    );
    expect(run(lang, '{"a": 10, "b": [20]}')).toBe("{ !10, [20] }\n");
    expect(seen).toContainEqual({ tag: "!" });
  });
});
