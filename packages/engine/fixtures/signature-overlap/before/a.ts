function g(a) {
  return a;
}

function f(x = g(1)) {
  return x;
}
