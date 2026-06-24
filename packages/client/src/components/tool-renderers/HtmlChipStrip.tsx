/**
 * Scans a tool result string for unique absolute HTML file paths and renders
 * one chip per path. Click → window.open('/api/file/raw?cwd=…&path=…').
 *
 * Mirrors ImageChipStrip. Only fires for .html/.htm with absolute paths inside
 * a known session cwd (the server's /api/file/raw requires it).
 * See change: chatview-inline-image-paths.
 */
import React, { useMemo } from "react";
import { useApiBase } from "../../lib/api-context.js";

const ABS_HTML_RE = /(?:^|[\s:])(\/([\w.-]+\/)*[\w.-]+\.html?)\b/gi;

function extractHtmlPaths(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  ABS_HTML_RE.lastIndex = 0;
  while ((m = ABS_HTML_RE.exec(text)) !== null) {
    const p = m[1];
    if (!seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

interface Props {
  text: string;
  cwd?: string;
}

export function HtmlChipStrip({ text, cwd }: Props) {
  const apiBase = useApiBase();
  const paths = useMemo(() => extractHtmlPaths(text), [text]);

  if (paths.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {paths.map((p) => {
        const dir = cwd ?? p.slice(0, p.lastIndexOf("/"));
        const file = p.slice(p.lastIndexOf("/") + 1);
        const url = `${apiBase}/api/file/raw?cwd=${encodeURIComponent(dir)}&path=${encodeURIComponent(file)}`;
        const name = basename(p);
        return (
          <button
            key={p}
            type="button"
            onClick={() => window.open(url, "_blank", "noopener")}
            className="inline-flex items-center gap-2 bg-[var(--bg-secondary,#1e1e21)] border border-[var(--border-subtle)] rounded-md px-2 py-1.5 hover:border-blue-500/60 hover:bg-blue-500/10 transition-colors cursor-pointer text-left"
          >
            <div className="w-6 h-6 rounded flex items-center justify-center bg-blue-500/10 border border-blue-500/20 flex-shrink-0">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-blue-400">
                <path d="M2 4l4-3h8v14H2V4z" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M6 1v3H2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <path d="M5 8l-2 2 2 2M11 8l2 2-2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[11px] text-[var(--text)] font-medium leading-tight truncate max-w-[180px]">{name}</span>
              <span className="text-[10px] text-[var(--text-muted)] leading-tight">HTML · open in new tab</span>
            </span>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="text-[var(--text-muted)] flex-shrink-0 ml-1">
              <path d="M7 3H3v10h10V9M13 3H9m4 0v4M13 3L7 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        );
      })}
    </div>
  );
}
