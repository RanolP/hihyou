/**
 *   Sums   price times quantity
    *  over every item.
 */
export function total(
    items: { price: number, qty: number }[]
) {
    let sum = 0

    for (const item of items) {
        sum += item.price * item.qty
    }
    return sum
}
