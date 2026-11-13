import type { Analysis, CommitRow } from "./types";

// Release-stability measures, computed in the app so that numbers exported to JSON can't drift from what
// the dashboard shows. The definitions follow the reviewer's script, with one change: commits are counted
// the way the AI share is (no bots, no reverts or version bumps).

const DAY = 86400;
const YEAR = 365 * DAY;
const SEMVER = /(\d+)\.(\d+)\.(\d+)/;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const counted = (c: CommitRow) => !c.bot && !c.x;
const isAi = (c: CommitRow) => c.ag.length > 0 && !c.bot;

export type VersionStyle = "patch" | "minor-bump" | "calendar" | "rolling-builds" | "none";

export interface Stability {
  asOf: string;
  versionStyle: VersionStyle;
  /** releases in the 12 months before asOf, and in the 12 months before that */
  releases: { last12Months: number; previous12Months: number };
  medianDaysBetween: number | null;
  /** counted commits per release (no bots, reverts or version bumps) */
  commitsPerRelease: {
    median: number | null;
    max: number | null;
    releasesOver50Commits: number;
    /** every commit between two releases, bots and version bumps included. Generated SDKs ship their code in bot commits, so use this for them. */
    includingBots: { median: number | null; max: number | null; releasesOver50Commits: number };
  };
  /** share of releases that are patch releases (x.y.Z with Z > 0) */
  patchReleasePct: number | null;
  /** feature releases (x.y.0) followed by a patch within 7 days. Only meaningful for patch-style projects. */
  fixedWithin7Days: { applicable: boolean; featureReleases: number; fixed: number };
  /** new major versions (X.0.0, X >= 1) in the last 12 months; not tracked for calendar versions */
  newMajors: string[];
  preOnePointZero: boolean | null;
  latestStable: string | null;
  daysSinceLatestRelease: number | null;
  /** counted commits since the latest stable release */
  unreleasedCommits: number | null;
  /** rolling-build projects: tagged builds in the last 12 months */
  buildsLast12Months: number | null;
  aiSharePct: { last12Months: number | null; previous12Months: number | null };
}

export function stability(data: Analysis, asOf: number): Stability {
  const commits = data.commits.filter((c) => c.t <= asOf);
  const rel = data.releases
    .filter((r) => r.stable && r.t <= asOf)
    .map((r) => {
      const m = r.name.match(SEMVER);
      return m ? { name: r.name, t: r.t, major: +m[1], minor: +m[2], patch: +m[3] } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.t - b.t);

  const inYear = (t: number) => t > asOf - YEAR && t <= asOf;
  const inPrev = (t: number) => t > asOf - 2 * YEAR && t <= asOf - YEAR;
  const yearRel = rel.filter((r) => inYear(r.t));
  const prevRel = rel.filter((r) => inPrev(r.t));

  const intervals: number[] = [];
  const perRelease: number[] = [];
  const perReleaseAll: number[] = [];
  for (let i = 1; i < rel.length; i++) {
    if (!inYear(rel[i].t)) continue;
    intervals.push((rel[i].t - rel[i - 1].t) / DAY);
    perRelease.push(commits.filter((c) => counted(c) && c.t > rel[i - 1].t && c.t <= rel[i].t).length);
    perReleaseAll.push(commits.filter((c) => c.t > rel[i - 1].t && c.t <= rel[i].t).length);
  }

  const calendar = rel.length > 0 && rel.filter((r) => r.major >= 2000).length > rel.length / 2;
  const patchy = yearRel.length >= 4 && yearRel.filter((r) => r.patch > 0).length / yearRel.length >= 0.4;
  const builds = data.releases.filter((r) => r.rolling && inYear(r.t)).length;

  let versionStyle: VersionStyle = calendar ? "calendar" : patchy ? "patch" : rel.length ? "minor-bump" : "none";
  if (data.releaseStyle === "rolling-builds") versionStyle = "rolling-builds";

  const features = yearRel.filter((r) => r.patch === 0);
  const fixed = features.filter((f) => rel.some((r) => r.major === f.major && r.minor === f.minor && r.patch >= 1 && r.t > f.t && r.t - f.t <= 7 * DAY));
  const latest = rel.at(-1) ?? null;

  const share = (inWindow: (t: number) => boolean) => {
    const base = commits.filter((c) => inWindow(c.t) && counted(c));
    return base.length ? Number(((base.filter(isAi).length / base.length) * 100).toFixed(1)) : null;
  };

  return {
    asOf: new Date(asOf * 1000).toISOString().slice(0, 10),
    versionStyle,
    releases: { last12Months: yearRel.length, previous12Months: prevRel.length },
    medianDaysBetween: median(intervals) === null ? null : Number(median(intervals)!.toFixed(1)),
    commitsPerRelease: {
      median: median(perRelease),
      max: perRelease.length ? Math.max(...perRelease) : null,
      releasesOver50Commits: perRelease.filter((n) => n > 50).length,
      includingBots: {
        median: median(perReleaseAll),
        max: perReleaseAll.length ? Math.max(...perReleaseAll) : null,
        releasesOver50Commits: perReleaseAll.filter((n) => n > 50).length,
      },
    },
    patchReleasePct: yearRel.length ? Math.round((yearRel.filter((r) => r.patch > 0).length / yearRel.length) * 100) : null,
    fixedWithin7Days: { applicable: versionStyle === "patch", featureReleases: features.length, fixed: fixed.length },
    newMajors: calendar ? [] : yearRel.filter((r) => r.major >= 1 && r.minor === 0 && r.patch === 0).map((r) => r.name),
    preOnePointZero: latest && !calendar ? latest.major === 0 : null,
    latestStable: latest?.name ?? null,
    daysSinceLatestRelease: latest ? Number(((asOf - latest.t) / DAY).toFixed(1)) : null,
    unreleasedCommits: latest ? commits.filter((c) => counted(c) && c.t > latest.t).length : null,
    buildsLast12Months: data.releaseStyle === "rolling-builds" ? builds : null,
    aiSharePct: { last12Months: share(inYear), previous12Months: share(inPrev) },
  };
}

export interface MergeStyleYear {
  year: number;
  /** commits in the stats (merge commits are not part of them) */
  commits: number;
  /** squash-merged pull requests: subject ends in (#123) */
  squashPct: number;
  /** merge commits that landed in the year */
  mergeCommits: number;
  /** merge commits per 100 commits */
  mergeCommitsPer100: number;
}

/**
 * How changes reach the main branch. Switching from merge commits to squash merges changes the commit count
 * by itself (a 10-commit PR becomes 1 commit), so a drop in commits is not always a slowdown.
 */
export function mergeStyle(data: Analysis): { years: MergeStyleYear[]; note: string } {
  const years = new Map<number, { commits: number; squash: number; merges: number }>();
  const row = (y: number) => years.get(y) ?? years.set(y, { commits: 0, squash: 0, merges: 0 }).get(y)!;
  for (const c of data.commits) {
    if (c.bot) continue;
    const r = row(new Date(c.t * 1000).getUTCFullYear());
    r.commits++;
    if (c.sq) r.squash++;
  }
  for (const t of data.mergeTimes ?? []) row(new Date(t * 1000).getUTCFullYear()).merges++;

  const out = [...years.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, r]) => ({
      year,
      commits: r.commits,
      squashPct: r.commits ? Math.round((r.squash / r.commits) * 100) : 0,
      mergeCommits: r.merges,
      mergeCommitsPer100: r.commits ? Number(((r.merges / r.commits) * 100).toFixed(1)) : 0,
    }));
  const shifted = out.length > 1 && Math.abs(out[out.length - 1].squashPct - out[0].squashPct) >= 30;
  return {
    years: out,
    note: shifted
      ? "The squash-merge share changed a lot over time. Commit counts before and after are not comparable: squashing turns a whole pull request into one commit."
      : "The squash-merge share is steady, so commit counts are comparable across years.",
  };
}
