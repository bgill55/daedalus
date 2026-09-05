export interface TouchTargetConfig {
  /** CSS selector for the interactive element (e.g., '.btn-primary', '#nav-link') */
  selector: string;
  /** Minimum width and height in pixels. Default is 48. */
  minSizePx?: number;
  /** Optional touch‑action CSS value. Defaults to 'manipulation'. */
  touchAction?: string;
}