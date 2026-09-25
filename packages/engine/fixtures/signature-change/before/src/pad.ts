export function padStart(text: string, width: number): string {
  return " ".repeat(Math.max(0, width - text.length)) + text;
}
