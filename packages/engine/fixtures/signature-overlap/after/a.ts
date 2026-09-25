function g(a, b) {
  return a + b;
}

export function f(x = g(1, 2)) {
  return x;
}
