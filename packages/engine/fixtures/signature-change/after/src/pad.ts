export function padStart(text: string, width: number, fill = " "): string {
  return fill.repeat(Math.max(0, width - text.length)) + text;
}
