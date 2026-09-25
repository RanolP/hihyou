export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function truncate(text: string, max = 72): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
