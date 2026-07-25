export function maskKey(key: string): string {
  if (key.length <= 7) return 'SET (*** )';
  const first = key.slice(0, 3);
  const last = key.slice(-4);
  return `SET (${first}…${last})`;
}
