function g(a) {
  return a;
}

export function f(x = g(1)) {
  return x;
}
