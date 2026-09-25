function g(a, b) {
  return a + b;
}

function f(x = g(1, 2)) {
  return x;
}
