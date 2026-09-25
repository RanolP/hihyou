export interface Item {
  price: number;
  quantity: number;
}

export function sumAll(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
