import { type Item, total } from "./cart";

export function receipt(items: Item[]): string {
  const due = total(items);
  return `Total due: ${due}`;
}

export function isFree(items: Item[]): boolean {
  return total(items) === 0;
}
