/**
 * Scans a tool result string for unique absolute image paths and renders one
 * compact attachment chip per path below the text output.
 *
 * Chip: [thumbnail] filename · click → ImageLightbox.
 * Image served via /api/image?path=<absolute> (no CWD restriction, image-ext only).
 * See change: chatview-inline-image-paths.
 */
import React, { useMemo, useState } from "react";
import { useApiBase } from "../../lib/api-context.js";
import { ImageLightbox } from "../ImageLightbox.js";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]);

function isImageExt(p: string): boolean {
  const dot = p.lastIndexOf(".");
  if (dot === -1) return false;
  return IMAGE_EXTS.has(p.slice(dot).toLowerCase());
}

// Match absolute POSIX paths with image extensions (same pattern as linkify-tool-output).
const ABS_IMAGE_RE = /(?:^|[\s:])(\/([\w.-]+\/)*[\w.-]+\.(png|jpe?g|gif|webp|svg|bmp))\b/gi;

function extractImagePaths(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  ABS_IMAGE_RE.lastIndex = 0;
  while ((m = ABS_IMAGE_RE.exec(text)) !== null) {
    const p = m[1];
    if (!seen.has(p) && isImageExt(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

interface Props {
  text: string;
}

export function ImageChipStrip({ text }: Props) {
  const apiBase = useApiBase();
  const paths = useMemo(() => extractImagePaths(text), [text]);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  if (paths.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2 mt-2">
        {paths.map((p) => {
          const src = `${apiBase}/api/image?path=${encodeURIComponent(p)}`;
          const name = basename(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => setLightbox({ src, alt: name })}
              className="inline-flex items-center gap-2 bg-[var(--bg-secondary,#1e1e21)] border border-[var(--border-subtle)] rounded-md px-2 py-1.5 hover:border-blue-500/60 hover:bg-blue-500/10 transition-colors cursor-pointer text-left"
            >
              <img
                src={src}
                alt={name}
                className="h-8 w-14 object-cover object-top rounded flex-shrink-0 border border-[var(--border-subtle)]"
              />
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[11px] text-[var(--text)] font-medium leading-tight truncate max-w-[180px]">
                  {name}
                </span>
              </span>
              <svg className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 3h4M3 3v4M13 3h-4M13 3v4M3 13h4M3 13v-4M13 13h-4M13 13v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          );
        })}
      </div>
      {lightbox && (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}
