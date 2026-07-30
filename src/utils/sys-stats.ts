import fs from 'fs';
import os from 'os';

export interface MemoryStats {
  total: number;
  free: number;
  used: number;
  usagePercent: number;
}

export interface DiskStats {
  path: string;
  total: number;
  free: number;
  used: number;
  usagePercent: number;
}

export async function getMemoryStats(): Promise<MemoryStats> {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  const usagePercent = total === 0 ? 0 : Number(((used / total) * 100).toFixed(2));
  return {
    total,
    free,
    used,
    usagePercent,
  };
}

export async function getDiskStats(targetPath: string): Promise<DiskStats> {
  try {
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(targetPath);
      const bsize = stats.bsize || 4096;
      const total = stats.blocks * bsize;
      const free = stats.bavail * bsize;
      const used = Math.max(0, total - free);
      const usagePercent = total === 0 ? 0 : Number(((used / total) * 100).toFixed(2));
      return {
        path: targetPath,
        total,
        free,
        used,
        usagePercent,
      };
    }
  } catch {
    // Fallback if statfsSync fails
  }

  return {
    path: targetPath,
    total: 0,
    free: 0,
    used: 0,
    usagePercent: 0,
  };
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 Bytes';
  }

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  if (i < 0) return '0 Bytes';

  const size = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
  return `${size} ${sizes[i]}`;
}
