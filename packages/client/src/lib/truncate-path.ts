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

/**
 * Format a raw filesystem path for display in the folder header.
 *
 * Strips noisy mount prefixes (EFS/NFS FS IDs) and collapses home
 * directories to `~` before truncating, so users see readable paths
 * instead of opaque identifiers like `fs-04bf86d02daf87e14`.
 *
 * Priority:
 *   1. EFS/NFS mounts  -- /mnt/{x}/efs/fs-<id>/... -> ~/...
 *   2. Explicit home   -- strip home prefix -> ~/...
 *   3. Generic home    -- /home/<user>/... or /Users/<user>/... -> ~/...
 *   4. Anything else   -- passed through to truncatePathMiddle unchanged
 *
 * Examples:
 *   formatFolderPath("/mnt/custom-file-systems/efs/fs-04bf/src/myapp")
 *     -> "~/src/myapp"
 *
 *   formatFolderPath("/home/alice/projects/deep/nested/myapp")
 *     -> "~/nested/myapp"
 *
 *   formatFolderPath("/Users/rob/dev/myapp", "/Users/rob")
 *     -> "~/dev/myapp"
 */
export function formatFolderPath(path: string, home?: string): string {
  if (!path) return path;
  let p = path;

  // 1. EFS / NFS mounts with opaque FS IDs: /mnt/*/efs/fs-<hexid>/…
  const efsMatch = p.match(/^\/mnt\/[^/]*\/efs\/fs-[0-9a-f]+\/(.*)/);
  if (efsMatch) {
    p = `~/${efsMatch[1]}`;
  // 2. Explicit home prefix
  } else if (home && (p === home || p.startsWith(`${home}/`))) {
    p = `~${p.slice(home.length)}`;
  // 3. Generic Linux / macOS home pattern
  } else {
    p = p.replace(/^\/(?:home|Users)\/[^/]+\//, "~/");
  }

  return truncatePathMiddle(p, 40);
}
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
