export function f(x = g(1)) {
  return x;
}

function g(a) {
  return a;
}
