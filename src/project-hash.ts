import crypto from 'crypto';
import path from 'path';

export function getProjectHash(projectRoot: string): string {
  return crypto.createHash('sha256').update(path.resolve(projectRoot)).digest('hex').slice(0, 12);
}
