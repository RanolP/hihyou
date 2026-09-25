export function connect(host: string) {
  const retries = 5;
  return open(host, { retries, timeout: 1000 });
}
