/**
 * Tail-truncate a filesystem path to fit within maxLen characters.
 * Preserves the last 2 path segments (parent dir + final dir name),
 * replacing the omitted prefix with "…".
 *
 * Examples:
 *   truncatePathMiddle("/mnt/custom-file-systems/efs-04bf/pr-application", 40)
 *     → "…/efs-04bf/pr-application"
 *
 *   truncatePathMiddle("/Users/robson/Project/some/deep/judo-meta-esm", 40)
 *     → "…/deep/judo-meta-esm"
 */
export function truncatePathMiddle(path: string, maxLen: number): string {
  if (!path || path.length <= maxLen) return path;

  const segments = path.split("/");
  // segments[0] is "" for absolute paths (leading /)
  if (segments.length <= 2) return path;

  const last = segments[segments.length - 1];
  const parent = segments[segments.length - 2];

  // Prefer keeping 2 tail segments: "…/parent/last"
  const twoSeg = `…/${parent}/${last}`;
  if (twoSeg.length <= maxLen) return twoSeg;

  // Fall back to just last segment: "…/last"
  const oneSeg = `…/${last}`;
  if (oneSeg.length <= maxLen) return oneSeg;

  // Pathological: even that is too long — return untruncated
  return path;
}
