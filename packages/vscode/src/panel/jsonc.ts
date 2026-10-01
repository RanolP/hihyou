/** JSON with comments and trailing commas, as VS Code theme files are written. */
export function parseJsonc(text: string): unknown {
  return JSON.parse(dropTrailingCommas(dropComments(text)));
}

/** Index just past the string literal opening at `i`. */
function stringEnd(text: string, i: number): number {
  for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
  return i + 1;
}

function dropComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (text[i] === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (text.startsWith("//", i)) {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      out += " ";
    } else out += text[i++];
  }
  return out;
}

function dropTrailingCommas(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (text[i] === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (text[i] === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] as string)) j++;
      if (text[j] === "}" || text[j] === "]") {
        i++;
        continue;
      }
    }
    out += text[i++];
  }
  return out;
}
