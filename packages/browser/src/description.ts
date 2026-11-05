const safeHref = (href: string) => {
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};

const appendLink = (
  parent: ParentNode,
  label: string,
  href: string,
  document: Document,
) => {
  const safe = safeHref(href);
  if (!safe) {
    parent.append(document.createTextNode(label));
    return;
  }
  const link = document.createElement("a");
  link.href = safe;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  // A link's label never links again, so a bare URL as its own label does not recurse.
  appendInline(link, label, document, false);
  parent.append(link);
};

const closingDelimiter = (text: string, start: number, delimiter: string) => {
  const end = text.indexOf(delimiter, start + delimiter.length);
  return end > start + delimiter.length ? end : -1;
};

const appendInline = (
  parent: ParentNode,
  text: string,
  document: Document,
  links = true,
) => {
  let plain = "";
  const flush = () => {
    if (plain) parent.append(document.createTextNode(plain));
    plain = "";
  };

  for (let index = 0; index < text.length;) {
    const rest = text.slice(index);
    const image = /^!\[([^\]]*)\]\(([^\s)]+)\)/.exec(rest);
    const link = /^\[([^\]]+)\]\(([^\s)]+)\)/.exec(rest);
    if (links && (image || link)) {
      flush();
      const match = image ?? link!;
      appendLink(parent, match[1]!, match[2]!, document);
      index += match[0].length;
      continue;
    }

    const bare = /^https?:\/\/[^\s<>]+/.exec(rest);
    if (links && bare) {
      const href = bare[0].replace(/[),.;:!?]+$/, "");
      if (href) {
        flush();
        appendLink(parent, href, href, document);
        index += href.length;
        continue;
      }
    }

    const delimiters = [
      ["**", "strong"],
      ["__", "strong"],
      ["~~", "s"],
      ["`", "code"],
      ["*", "em"],
      ["_", "em"],
    ] as const;
    const delimiter = delimiters.find(([marker]) => rest.startsWith(marker));
    if (delimiter) {
      const [marker, tag] = delimiter;
      const end = closingDelimiter(text, index, marker);
      if (end !== -1) {
        flush();
        const element = document.createElement(tag);
        const content = text.slice(index + marker.length, end);
        if (tag === "code") element.textContent = content;
        else appendInline(element, content, document, links);
        parent.append(element);
        index = end + marker.length;
        continue;
      }
    }

    plain += text[index];
    index += 1;
  }
  flush();
};

const isFence = (line: string) => /^\s*(`{3,}|~{3,})/.test(line);
const isHeading = (line: string) => /^\s*#{1,6}[ \t]+/.test(line);
const isRule = (line: string) =>
  /^\s*(?:\*\s*){3,}$/.test(line) ||
  /^\s*(?:-\s*){3,}$/.test(line) ||
  /^\s*(?:_\s*){3,}$/.test(line);
const listItem = (line: string) =>
  /^\s*(?:([-+*])|(\d+\.))[ \t]+(.+)$/.exec(line);
const startsBlock = (line: string) =>
  isFence(line) ||
  isHeading(line) ||
  isRule(line) ||
  listItem(line) !== null ||
  /^\s*>/.test(line);

const appendBlocks = (
  fragment: DocumentFragment | HTMLElement,
  lines: string[],
  document: Document,
) => {
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^\s*(`{3,}|~{3,}).*$/.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const codeLines: string[] = [];
      index += 1;
      const close = new RegExp(
        `^\\s*${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`,
      );
      while (index < lines.length && !close.test(lines[index]!)) {
        codeLines.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.append(code);
      fragment.append(pre);
      continue;
    }

    const heading = /^\s*(#{1,6})[ \t]+(.+?)[ \t]*#*\s*$/.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1]!.length + 3) as 4 | 5 | 6;
      const element = document.createElement(`h${level}`);
      appendInline(element, heading[2]!, document);
      fragment.append(element);
      index += 1;
      continue;
    }

    if (isRule(line)) {
      fragment.append(document.createElement("hr"));
      index += 1;
      continue;
    }

    const firstItem = listItem(line);
    if (firstItem) {
      const ordered = firstItem[2] !== undefined;
      const list = document.createElement(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const item = listItem(lines[index]!);
        if (!item || (item[2] !== undefined) !== ordered) break;
        const element = document.createElement("li");
        const task = /^\[([ xX])\][ \t]+(.*)$/.exec(item[3]!);
        if (task && !ordered) {
          element.className = "hh-description-task";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.disabled = true;
          checkbox.checked = task[1]!.toLowerCase() === "x";
          checkbox.setAttribute(
            "aria-label",
            checkbox.checked ? "Completed task" : "Incomplete task",
          );
          element.append(checkbox);
          appendInline(element, task[2]!, document);
        } else {
          appendInline(element, item[3]!, document);
        }
        list.append(element);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const quote = /^\s*>[ \t]?(.*)$/.exec(lines[index]!);
        if (!quote) break;
        quoteLines.push(quote[1]!);
        index += 1;
      }
      const blockquote = document.createElement("blockquote");
      appendBlocks(blockquote, quoteLines, document);
      fragment.append(blockquote);
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      (paragraphLines.length === 0 || !startsBlock(lines[index]!))
    ) {
      paragraphLines.push(lines[index]!);
      index += 1;
    }
    const paragraph = document.createElement("p");
    paragraphLines.forEach((paragraphLine, lineIndex) => {
      if (lineIndex > 0) paragraph.append(document.createElement("br"));
      appendInline(paragraph, paragraphLine, document);
    });
    fragment.append(paragraph);
  }
};

export function renderDescription(
  body: string,
  document: Document,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  appendBlocks(fragment, body.replace(/\r\n?/g, "\n").split("\n"), document);
  return fragment;
}
