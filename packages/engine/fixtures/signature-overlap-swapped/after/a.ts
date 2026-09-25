export function f(x = g(1, 2)) {
  return x;
}

function g(a, b) {
  return a + b;
}
