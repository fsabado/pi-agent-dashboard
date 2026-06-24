import { fileURLToPath } from "node:url";

export function decodeFileUri(value: string): string {
  if (!/^file:\/\//i.test(value)) return value;
  try { return fileURLToPath(value); } catch {
    const stripped = value.replace(/^file:\/\//i, "");
    try { return decodeURIComponent(stripped); } catch { return stripped; }
  }
}
