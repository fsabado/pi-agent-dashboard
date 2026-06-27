/**
 * Top-of-page banner rendered when any `required` recommended extension
 * is not active in pi (not present in ~/.pi/agent/settings.json packages[]).
 *
 * - Consumes useRecommendedExtensions and filters to required + !activeInPi.
 * - If the missing required entries are already on disk (just not active),
 *   offers a cheap "Activate" action that re-runs installAndPersist under
 *   the on-disk scope — pi skips the download and just registers in
 *   settings.json.
 * - Otherwise offers the full "Install" action (clones / downloads).
 * - Dismissible per-session via sessionStorage key
 *   `pi-dashboard:missing-required-dismissed`. Dismissal is per-session
 *   (resets on page reload) but re-appears on the next load while the
 *   condition persists.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@mdi/react";
import { mdiAlertCircle, mdiClose, mdiPlusCircle, mdiLoading, mdiFlashAuto } from "@mdi/js";
import { useRecommendedExtensions } from "../hooks/useRecommendedExtensions.js";
import { usePackageOperations } from "../hooks/usePackageOperations.js";
import { t as i18nT } from "../lib/i18n";

const DISMISSED_KEY = "pi-dashboard:missing-required-dismissed";

export function MissingRequiredBanner() {
  const { recommended, refresh } = useRecommendedExtensions();
  const ops = usePackageOperations("global", undefined, refresh);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const missing = useMemo(
    () => recommended.filter((e) => e.status === "required" && !e.activeInPi),
    [recommended],
  );

  // If every missing entry is on disk (`installed.scope !== null`) we can
  // offer the cheaper "Activate" path. If at least one is genuinely absent,
  // fall back to the full "Install" label.
  const allOnDisk = useMemo(
    () => missing.length > 0 && missing.every((e) => e.installed.scope !== null),
    [missing],
  );
  const actionLabel = allOnDisk ? "Activate" : "Install";
  const actionIcon = allOnDisk ? mdiFlashAuto : mdiPlusCircle;

  // Reset the dismissed flag when the missing set becomes empty, so the
  // banner can reappear cleanly if an entry is later removed.
  useEffect(() => {
    if (missing.length === 0 && dismissed) {
      try {
        sessionStorage.removeItem(DISMISSED_KEY);
      } catch {
        /* ignore */
      }
      setDismissed(false);
    }
  }, [missing.length, dismissed]);

  const onDismiss = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }, []);

  const onAction = useCallback(() => {
    for (const entry of missing) {
      // If on disk, use the on-disk scope so we persist into the matching
      // settings.json (global vs project). Otherwise fall back to global.
      const target =
        entry.installed.scope === "global" || entry.installed.scope === "local"
          ? entry.installed.scope
          : undefined;
      ops.install(entry.source, target);
    }
  }, [missing, ops]);

  if (dismissed || missing.length === 0) return null;

  const anyBusy = ops.operation.status === "running";

  return (
    <div
      role="alert"
      className="mx-2 my-2 p-3 bg-danger/10 border border-danger/40 rounded-lg"
      data-testid="missing-required-banner"
    >
      {/* title row: icon + text + dismiss */}
      <div className="flex items-start gap-2">
        <Icon path={mdiAlertCircle} size={0.75} className="text-danger flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-danger leading-snug">
            {missing.length === 1
              ? allOnDisk
                ? `${missing[0].displayName} is installed but not active in pi`
                : `${missing[0].displayName} is not installed`
              : allOnDisk
                ? `${missing.length} required extensions are installed but not active in pi`
                : `${missing.length} required extensions are not installed`}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="flex-shrink-0 p-0.5 -mt-0.5 -mr-0.5 rounded hover:bg-danger/10 text-muted"
          data-testid="missing-required-dismiss"
          aria-label={i18nT("auto.dismiss", undefined, "Dismiss")}
        >
          <Icon path={mdiClose} size={0.65} />
        </button>
      </div>
      {/* body: description + install button */}
      <div className="ml-[22px] mt-1.5">
        <ul className="text-xs text-muted space-y-0.5">
          {missing.map((entry) => (
            <li key={entry.id}>
              {entry.installed.scope && (
                <span className="text-success">{i18nT("auto.on_disk", undefined, "(on disk:")} {entry.installed.scope})</span>
              )}
              {entry.unlocks.length > 0 && (
                <>{i18nT("auto.unlocks", undefined, "Unlocks:")} {entry.unlocks.join(", ")}</>
              )}
            </li>
          ))}
        </ul>
        <button
          onClick={onAction}
          disabled={anyBusy}
          className="mt-2 text-xs px-3 py-1.5 rounded-md bg-danger text-white hover:bg-danger/80 flex items-center gap-1.5 font-medium disabled:opacity-50"
          data-testid="missing-required-install"
        >
          {anyBusy ? <Icon path={mdiLoading} size={0.6} spin /> : <Icon path={actionIcon} size={0.6} />}
          {actionLabel}{missing.length === 1 ? ` ${missing[0].displayName}` : ""}
        </button>
      </div>
    </div>
  );
}
