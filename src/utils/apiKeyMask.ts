export function maskKey(key?: string | null): string {
  if (!key || key.trim() === '') return 'MISSING';
  if (key.length <= 7) return 'SET (***)';
  const first = key.slice(0, 3);
  const last = key.slice(-4);
  return `SET (${first}…${last})`;
}
