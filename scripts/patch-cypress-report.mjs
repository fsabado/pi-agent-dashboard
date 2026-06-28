#!/usr/bin/env node
/**
 * Patches ~/studio/cypress/index.html to inject a post-render script
 * that adds <video> players to each suite after React mounts.
 *
 * Approach: inject a <script> at the end of <body> that uses MutationObserver
 * to wait for React to render, then walks suite--filename elements to inject
 * videos using the spec→video mapping baked in at patch time.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";

const REPORT_DIR = join(homedir(), "studio", "cypress");
const HTML_FILE  = join(REPORT_DIR, "index.html");
const VIDEOS_DIR = join(REPORT_DIR, "videos");

if (!existsSync(HTML_FILE)) { console.log("[patch] No report found."); process.exit(0); }

function walkVideos(dir, base = VIDEOS_DIR) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkVideos(full, base));
    else if (e.name.endsWith(".mp4")) out.push(relative(base, full));
  }
  return out;
}

const videos = walkVideos(VIDEOS_DIR);
if (!videos.length) { console.log("[patch] No videos found."); process.exit(0); }

// Build spec→videoUrl map (with and without packages/ prefix)
const specMap = {};
for (const v of videos) {
  const spec = v.replace(/\.mp4$/, "");
  specMap[spec] = `videos/${v}`;
  specMap[`packages/${spec}`] = `videos/${v}`;
}

const script = `
<script id="cy-video-patch">
(function() {
  var specMap = ${JSON.stringify(specMap, null, 2)};
  var INJECTED = 'data-video-injected';

  function injectVideos() {
    var injected = 0;
    document.querySelectorAll('[class*="suite--filename"]').forEach(function(h6) {
      var spec = h6.textContent.trim();
      var videoUrl = specMap[spec];
      if (!videoUrl) return;

      // Walk up to the <details class="suite--details...">
      var details = h6.closest('[class*="suite--details"]');
      if (!details || details.hasAttribute(INJECTED)) return;
      details.setAttribute(INJECTED, '1');

      var summary = details.querySelector('summary');
      if (!summary) return;

      var wrap = document.createElement('div');
      wrap.style.cssText = 'padding:8px 16px 4px;background:#fafafa;border-bottom:1px solid #eceff1';
      wrap.innerHTML =
        '<video controls width="100%" style="border-radius:4px;max-height:280px;background:#111">' +
        '<source src="' + videoUrl + '" type="video/mp4">' +
        '</video>';

      summary.insertAdjacentElement('afterend', wrap);
      injected++;
    });
    return injected;
  }

  // Try immediately, then watch for React mount
  if (!injectVideos()) {
    var observer = new MutationObserver(function() {
      if (injectVideos()) observer.disconnect();
    });
    observer.observe(document.getElementById('report') || document.body, {
      childList: true, subtree: true
    });
  }
})();
</script>
`;

let html = readFileSync(HTML_FILE, "utf8");

// Remove any previous injection
html = html.replace(/<script id="cy-video-patch">[\s\S]*?<\/script>/g, "");

// Inject before </body>
if (!html.includes("</body>")) {
  html += script;
} else {
  html = html.replace("</body>", script + "</body>");
}

writeFileSync(HTML_FILE, html);
console.log(`[patch] Injected video script for ${videos.length} video(s) into ${HTML_FILE}`);
