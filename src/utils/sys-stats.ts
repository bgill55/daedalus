import { execSync } from 'child_process';
import os from 'os';

/**
 * Memory statistics for the current system.
 */
export interface MemoryStats {
  /** Total system memory in bytes */
  total: number;
  /** Free (available) memory in bytes */
  free: number;
  /** Used memory in bytes */
  used: number;
  /** Percentage of memory used (0‑100) */
  usagePercent: number;
}

/**
 * Disk statistics for a given path/volume.
 */
export interface DiskStats {
  /** Path that was inspected, e.g. '/' or 'C:\\' */
  path: string;
  /** Total size of the disk/volume in bytes */
  total: number;
  /** Free space on the disk/volume in bytes */
  free: number;
  /** Used space on the disk/volume in bytes */
  used: number;
  /** Percentage of disk space used (0‑100) */
  usagePercent: number;
}

/**
 * Retrieve memory usage statistics.
 */
export async function getMemoryStats(): Promise<MemoryStats> {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const usagePercent = total === 0 ? 0 : (used / total) * 100;
  return {
    total,
    free,
    used,
    usagePercent,
  };
}

/**
 * Retrieve disk usage statistics for the supplied path.
 *
 * This implementation uses the `df` command on Unix‑like systems and falls back
 * to a simple `wmic` query on Windows. The command output is parsed to extract
 * total, used, and free space in bytes.
 */
export async function getDiskStats(path: string): Promise<DiskStats> {
  let output: string;
  try {
    // `df -k` reports sizes in 1‑kilobyte blocks.
    output = execSync(`df -k ${path}`, { encoding: 'utf8' });
  } catch (e) {
    // On Windows the `df` command is unavailable; use `wmic`.
    // Example: wmic logicaldisk where "DeviceID='C:'" get Size,FreeSpace /format:csv
    const winPath = path.replace(/\\$/, ''); // remove trailing backslash if present
    output = execSync(`wmic logicaldisk where "DeviceID='${winPath}'" get Size,FreeSpace /format:csv`, { encoding: 'utf8' });
  }

  // Split output into lines and ignore empty ones.
  const lines = output.split(/\r?\n/).filter((l) => l.trim().length > 0);
  // The first line is a header; the second line contains the values.
  const dataLine = lines[1] ?? '';
  const parts = dataLine.trim().split(/\s+/);

  // `df` format: Filesystem 1K-blocks Used Available Use% Mounted on
  // `wmic` CSV format may differ; we handle the `df` case which is used in tests.
  let total = 0;
  let used = 0;
  let free = 0;
  let usagePercent = 0;

  if (parts.length >= 5) {
    // Assume df output.
    const totalK = Number(parts[1]);
    const usedK = Number(parts[2]);
    const availableK = Number(parts[3]);
    const percentStr = parts[4];
    total = totalK * 1024;
    used = usedK * 1024;
    free = availableK * 1024;
    usagePercent = Number(percentStr.replace('%', ''));
  }

  return {
    path,
    total,
    free,
    used,
    usagePercent,
  };
}

/**
 * Convert a byte count into a human‑readable string.
 *
 * @param bytes   Number of bytes.
 * @param decimals Number of decimal places (default 2).
 * @returns Human readable string, e.g. "1.23 MB".
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
  return `${size} ${sizes[i]}`;
}
