/**
 * Validate a version string against the project's supported SemVer format.
 *
 * Supported format:
 *   MAJOR.MINOR.PATCH            // e.g. "1.93.0"
 *   MAJOR.MINOR.PATCH-PRERELEASE // e.g. "1.93.0-canary", "2.0.1-beta.2"
 *
 * Rules:
 *   - MAJOR, MINOR, PATCH are non-negative integers without leading zeros
 *     (except the literal "0").
 *   - Pre-release, if present, must start with a hyphen followed by one or
 *     more ASCII alphanumeric and hyphen identifiers separated by dots (e.g. "-beta", "-rc.1").
 *   - Build metadata (e.g. "+001") is **not** allowed.
 *
 * @param v – Version string to validate.
 * @returns `true` if `v` conforms to the format, otherwise `false`.
 */
export function isValidSemver(v: string): boolean {
  if (!v) return false;
  const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
  return semverRegex.test(v);
}