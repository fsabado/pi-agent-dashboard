import { useEffect } from "react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const DEFAULT_TITLE = "PI Dashboard";

function buildDocumentTitle(session: DashboardSession | undefined, folderCwd?: string): string {
  function lastSegment(cwd: string, id: string) {
    const segs = cwd.split("/").filter(Boolean);
    return segs.length > 0 ? segs[segs.length - 1] : id.slice(0, 8);
  }
  if (session) {
    const dir = lastSegment(session.cwd, session.id);
    if (session.name?.trim()) {
      const name = session.name.trim();
      return name.toLowerCase() === dir.toLowerCase()
        ? `${name} — PI Dashboard`
        : `${name} (${dir}) — PI Dashboard`;
    }
    return `${dir} — PI Dashboard`;
  }
  if (folderCwd) return `${lastSegment(folderCwd, "")} — PI Dashboard`;
  return "PI Dashboard";
}

export function useDocumentTitle(session: DashboardSession | undefined, folderCwd?: string): void {
  useEffect(() => {
    document.title = buildDocumentTitle(session, folderCwd);
    return () => { document.title = DEFAULT_TITLE; };
  }, [session, folderCwd]);
}
