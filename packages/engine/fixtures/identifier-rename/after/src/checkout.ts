import { type Item, sumAll } from "./cart";

export function receipt(items: Item[]): string {
  const due = sumAll(items);
  return `Total due: ${due}`;
}

export function isFree(items: Item[]): boolean {
  return sumAll(items) === 0;
}
