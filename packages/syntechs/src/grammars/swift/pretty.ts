// A port of swift-format 6.3.0's PrettyPrinter (Sources/SwiftFormat/PrettyPrint/PrettyPrint.swift): an
// Oppen-style printer over a stream of text, group and break tokens. It covers the tokens the statements
// `layout.ts` builds streams for carry (no comments, verbatim text, selections or comma-delimited regions), so a
// stream it accepts prints as swift-format prints it.

export type BreakKind =
  | { k: "open"; block: boolean }
  | { k: "close"; mustBreak: boolean }
  | { k: "continue" }
  | { k: "same" }
  | { k: "reset" }
  | { k: "contextual" };

export type Tok =
  | { t: "syntax"; text: string }
  | { t: "open"; consistent: boolean }
  | { t: "close" }
  | { t: "break"; kind: BreakKind; size: number }
  | { t: "space"; size: number }
  | { t: "ctxStart" }
  | { t: "ctxEnd" };

export const tk = {
  syntax: (text: string): Tok => ({ t: "syntax", text }),
  open: (consistent = false): Tok => ({ t: "open", consistent }),
  close: { t: "close" } as Tok,
  space: { t: "space", size: 1 } as Tok,
  brk: (kind: BreakKind, size = 1): Tok => ({ t: "break", kind, size }),
  ctxStart: { t: "ctxStart" } as Tok,
  ctxEnd: { t: "ctxEnd" } as Tok,
};

interface OpenBreak {
  block: boolean;
  lineNumber: number;
  contributesContinuationIndent: boolean;
  contributesBlockIndent: boolean;
}

/**
 * The text swift-format prints for `tokens` on a line that starts at column `base` (every line it breaks onto
 * is indented from `base`), with lines of `lineLength` columns and an indent of `indent` spaces.
 */
export function prettyPrint(tokens: readonly Tok[], base: number, lineLength: number, indent: number): string {
  // Lengths: a group's is its whole text, a break's runs to the next break in its group (PrettyPrint.prettyPrint).
  const lengths: number[] = [];
  const stack: number[] = [];
  let total = 0;
  for (const [i, tok] of tokens.entries()) {
    switch (tok.t) {
      case "ctxStart":
      case "ctxEnd":
        lengths.push(0);
        break;
      case "open":
        lengths.push(-total);
        stack.push(i);
        break;
      case "close": {
        lengths.push(0);
        const index = stack.pop();
        if (index === undefined) throw new Error("an unmatched group close (layout)");
        lengths[index] = (lengths[index] as number) + total;
        if ((tokens[index] as Tok).t === "break") {
          const outer = stack.pop();
          if (outer === undefined) throw new Error("an unmatched group close (layout)");
          lengths[outer] = (lengths[outer] as number) + total;
        }
        break;
      }
      case "break": {
        const last = stack[stack.length - 1];
        if (last !== undefined && (tokens[last] as Tok).t === "break") {
          lengths[last] = (lengths[last] as number) + total;
          stack.pop();
        }
        lengths.push(-total);
        stack.push(i);
        total += tok.size;
        break;
      }
      case "space":
        lengths.push(tok.size);
        total += tok.size;
        break;
      case "syntax":
        lengths.push(tok.text.length);
        total += tok.text.length;
        break;
    }
  }
  const pending = stack.pop();
  if (pending !== undefined) lengths[pending] = (lengths[pending] as number) + total;
  if (stack.length > 0) throw new Error("an unclosed group (layout)");

  // PrettyPrintBuffer.
  let out = "";
  let atLineStart = true;
  let lineNumber = 1;
  let pendingSpaces = 0;
  let column = base;
  let consecutiveNewlines = 0;
  const openBreaks: OpenBreak[] = [];
  let continuation = false;
  const indentation = () =>
    base +
    indent *
      (openBreaks.reduce((n, o) => n + (o.contributesBlockIndent ? 1 : 0) + (o.contributesContinuationIndent ? 1 : 0), 0) +
        (continuation ? 1 : 0));
  const write = (text: string) => {
    if (atLineStart) {
      // The first line's indent is the statement's own, already in the text before it.
      if (lineNumber > 1) out += " ".repeat(indentation());
      column = indentation();
      atLineStart = false;
    } else if (pendingSpaces > 0) out += " ".repeat(pendingSpaces);
    out += text;
    consecutiveNewlines = 0;
    pendingSpaces = 0;
    column += text.length;
  };
  const newline = () => {
    if (consecutiveNewlines !== 0) return;
    out += "\n";
    lineNumber++;
    atLineStart = true;
    consecutiveNewlines++;
    pendingSpaces = 0;
    column = 0;
  };
  const canFit = (length = 1) => atLineStart || length <= lineLength - column;
  const compensatingLine = () => lineNumber - (atLineStart ? 1 : 0);

  let lastBreak = false;
  const forceBreak: boolean[] = [false];
  const continuationStack: boolean[] = [];
  interface Context {
    lineNumber: number;
    behavior: "unset" | "continuation" | "maintain";
  }
  const contexts: Context[] = [];
  let lastEnded: Context | undefined;

  for (const [i, tok] of tokens.entries()) {
    const length = lengths[i] as number;
    switch (tok.t) {
      case "ctxStart":
        contexts.push({ lineNumber, behavior: "unset" });
        lastEnded = undefined;
        break;
      case "ctxEnd": {
        const closed = contexts.pop();
        if (closed === undefined) throw new Error("an unmatched contextual breaking end (layout)");
        lastEnded = contexts.length === 0 ? undefined : closed;
        break;
      }
      case "open":
        forceBreak.push((!canFit(length) || lastBreak) && tok.consistent);
        break;
      case "close":
        forceBreak.pop();
        break;
      case "space":
        pendingSpaces += tok.size;
        column += tok.size;
        break;
      case "syntax":
        if (tok.text === "") break;
        lastBreak = false;
        write(tok.text);
        break;
      case "break": {
        let mustBreak = forceBreak[forceBreak.length - 1] ?? false;
        let continuationIfFires = false;
        const kind = tok.kind;
        switch (kind.k) {
          case "open": {
            const last = openBreaks[openBreaks.length - 1];
            const line = compensatingLine();
            if (line === (last?.lineNumber ?? 0) && kind.block && last !== undefined) last.contributesBlockIndent = false;
            const continuationWillFire = !kind.block && (atLineStart || !canFit(length) || mustBreak);
            openBreaks.push({
              block: kind.block,
              lineNumber: line,
              contributesContinuationIndent: continuation || continuationWillFire,
              contributesBlockIndent: kind.block,
            });
            continuationStack.push(continuation);
            continuation = false;
            break;
          }
          case "close": {
            const matching = openBreaks.pop();
            if (matching === undefined) throw new Error("an unmatched close break (layout)");
            const openedOnDifferentLine = compensatingLine() !== matching.lineNumber;
            if (matching.contributesBlockIndent) {
              const last = openBreaks[openBreaks.length - 1];
              if (matching.lineNumber === lineNumber && last !== undefined && last.block && !last.contributesBlockIndent)
                last.contributesBlockIndent = true;
            }
            if (kind.mustBreak) mustBreak = openedOnDifferentLine;
            else if (!canFit()) mustBreak = true;
            else
              continuation =
                (matching.contributesContinuationIndent || matching.contributesBlockIndent) && openedOnDifferentLine;
            const wasContinuation =
              (continuationStack.pop() ?? false) ||
              matching.contributesContinuationIndent ||
              (!matching.block && openedOnDifferentLine);
            continuation = continuation || wasContinuation;
            continuationIfFires = wasContinuation;
            break;
          }
          case "continue":
            continuationIfFires = true;
            break;
          case "same":
            break;
          case "reset":
            mustBreak = continuation;
            break;
          case "contextual": {
            const willFire = !canFit(length) || mustBreak;
            const active = contexts[contexts.length - 1];
            if (willFire && lastEnded !== undefined && active !== undefined && active.behavior === "unset")
              active.behavior = lastEnded.lineNumber === lineNumber ? "continuation" : "maintain";
            if (active !== undefined)
              continuationIfFires = active.behavior === "maintain" ? continuation : true;
            lastEnded = undefined;
            break;
          }
        }
        if (!canFit(length) || mustBreak) {
          continuation = continuationIfFires;
          newline();
          lastBreak = true;
        } else {
          if (atLineStart) continuation = continuationIfFires;
          pendingSpaces += tok.size;
          column += tok.size;
          lastBreak = false;
        }
        break;
      }
    }
  }
  if (openBreaks.length > 0) throw new Error("an open break left unclosed (layout)");
  // A break that fires after the last token ends the line the statement after it starts anyway.
  return out.replace(/\n+$/, "");
}
