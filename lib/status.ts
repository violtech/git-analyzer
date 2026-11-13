import type { Analysis } from "./types";

const DAY = 86400;

export type ProjectStatus = "releasing" | "developing" | "quiet";

export interface StatusOptions {
  /** a stable release or rolling build within this many days counts as releasing (default 180) */
  releasingDays?: number;
  /** a human commit within this many days counts as developing (default 90) */
  activeDays?: number;
}

export const STATUS_DEFAULTS = { releasingDays: 180, activeDays: 90 };

/**
 * Where a project stands, in this order of precedence:
 *   releasing  - a stable release (or, for rolling-build projects, a build) in the last `releasingDays`
 *   developing - no recent release, but a human commit in the last `activeDays`
 *   quiet      - neither
 * Works without any releases: a repository that never tags is developing or quiet. Bot commits do not count.
 */
export function projectStatus(data: Analysis, asOf: number, opts: StatusOptions = {}) {
  const releasingDays = opts.releasingDays ?? STATUS_DEFAULTS.releasingDays;
  const activeDays = opts.activeDays ?? STATUS_DEFAULTS.activeDays;

  const lastCommit = data.commits.filter((c) => !c.bot && c.t <= asOf).at(-1)?.t ?? null;
  const rel = data.releases.filter((r) => (r.stable || r.rolling) && r.t <= asOf).at(-1) ?? null;
  const daysSinceCommit = lastCommit === null ? null : (asOf - lastCommit) / DAY;
  const daysSinceRelease = rel === null ? null : (asOf - rel.t) / DAY;

  let status: ProjectStatus = "quiet";
  if (daysSinceRelease !== null && daysSinceRelease <= releasingDays) status = "releasing";
  else if (daysSinceCommit !== null && daysSinceCommit <= activeDays) status = "developing";

  return {
    status,
    lastCommit: lastCommit === null ? null : new Date(lastCommit * 1000).toISOString(),
    lastRelease: rel === null ? null : new Date(rel.t * 1000).toISOString(),
    lastReleaseKind: rel === null ? null : rel.rolling ? ("rolling-build" as const) : ("stable" as const),
    daysSinceCommit,
    daysSinceRelease,
    thresholds: { releasingDays, activeDays },
  };
}
