# Feature Specification: System Stats Utility

> **Summary:** Adds a utility module at src/utils/sys-stats.ts that provides typed functions to retrieve memory and disk usage statistics and a helper to format byte values. Includes comprehensive unit tests.

## 1. Interface & Data Contracts

### Interface: `MemoryStats` (`src/utils/sys-stats.ts`)
```ts
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
```

### Interface: `DiskStats` (`src/utils/sys-stats.ts`)
```ts
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
```

## 2. Function Signatures
- **`getMemoryStats`** in `src/utils/sys-stats.ts`: `export async function getMemoryStats(): Promise<MemoryStats>`
  - _Collects system memory information using Node's os module and returns a MemoryStats object. The function is async to keep a consistent API with getDiskStats, which may perform I/O._
- **`getDiskStats`** in `src/utils/sys-stats.ts`: `export async function getDiskStats(path: string): Promise<DiskStats>`
  - _Retrieves total, free and used disk space for the supplied path. Uses the 'diskusage' npm package (or built‑in fs.statfs on supported platforms) and returns a DiskStats object._
- **`formatBytes`** in `src/utils/sys-stats.ts`: `export function formatBytes(bytes: number, decimals?: number): string`
  - _Converts a byte count into a human‑readable string (e.g., 1024 → "1 KB"). Optional decimals parameter controls precision._

## 3. Test Cases & Verification Assertions
- [ ] **[UNIT_TEST] MemoryStats returns valid percentages** (`src/utils/__tests__/sys-stats.test.ts`)
  - Calls getMemoryStats and asserts that total, free, used are numbers, that used = total - free (within a small delta), and that usagePercent is between 0 and 100.
- [ ] **[UNIT_TEST] DiskStats works for root path** (`src/utils/__tests__/sys-stats.test.ts`)
  - Invokes getDiskStats('/') (or 'C:\\' on Windows) and checks that the returned object contains numeric total, free, used, usagePercent fields and that usagePercent is within 0‑100.
- [ ] **[UNIT_TEST] formatBytes produces expected strings** (`src/utils/__tests__/sys-stats.test.ts`)
  - Verifies that formatBytes(0) === "0 Bytes", formatBytes(1024) === "1 KB", formatBytes(1536, 1) === "1.5 KB", and formatBytes(1048576) === "1 MB".

## 4. Verification Commands
- `npm run build`
- `npm test`
