export function connect(host: string) {
  const retries = 3;
  return open(host, { retries, timeout: 1000 });
}
