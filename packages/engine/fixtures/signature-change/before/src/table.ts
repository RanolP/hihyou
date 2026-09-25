import { padStart } from "./pad";

export function row(cells: string[]): string {
  return cells.map((cell) => padStart(cell, 8)).join("|");
}
