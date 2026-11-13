import type { AuthorKind } from "./agents";
import pkg from "../package.json";
import { quarters, QUARTER_DEFINITION, type QuarterOptions } from "./quarters";
import { projectStatus, type StatusOptions } from "./status";
import { tagCounts } from "./tag-counts";
import type { Analysis, Granularity, PullStats } from "./types";
import { atAsOf, buildView, rangeStart, type Range, type View } from "./view";

// The machine-readable twin of the dashboard. It is built from the same buildView() the UI uses,
// so a number an agent reads here is the number a person sees on screen.

export const SECTIONS = [
  "summary",
  "timeline",
  "velocity",
  "releases",
  "intervals",
  "pulls",
  "people",
  "ai",
  "detection",
  "bulk",
  "pulse",
  "stability",
  "quarters",
  "mergeStyle",
  "heatmap",
] as const;
export type Section = (typeof SECTIONS)[number];

export interface ReportOptions {
  period?: Granularity;
  range?: Range;
  kind?: AuthorKind;
  /** default false, same as the dashboard toggle: leave large commits out of added/deleted line stats */
  excludeBulk?: boolean;
  /** default: everything except heatmap */
  sections?: Section[];
  /** rows kept in `people` */
  limit?: number;
  /** reference time for "last 12 months" measures, unix seconds (default: now). Fix it to reproduce a report. */
  asOf?: number;
  /** `quarters` section: how many calendar quarters (default 4) and when a quarter counts as a large change */
  quarters?: QuarterOptions;
  /** `pulse` status thresholds in days (defaults: releasing 180, developing 90) */
  status?: StatusOptions;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** "2026-10-30" means the end of that day (UTC), so the whole day counts. Returns NaN for anything else. */
export function parseAsOf(s: string): number {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59) / 1000;
  return new Date(t * 1000).getUTCDate() === +m[3] ? t : NaN; // rejects 2026-02-31
}

export function buildReport(raw: Analysis, rawPulls: PullStats | null, opts: ReportOptions = {}) {
  const period = opts.period ?? "month";
  const range = opts.range ?? "all";
  const kind = opts.kind ?? "all";
  const excludeBulk = opts.excludeBulk ?? false;
  const limit = opts.limit ?? 50;
  const want = new Set<Section>(opts.sections ?? SECTIONS.filter((s) => s !== "heatmap"));

  // everything after asOf is ignored, so a report can be reproduced later
  const data = opts.asOf === undefined ? raw : atAsOf(raw, opts.asOf);
  const pulls = rawPulls && opts.asOf !== undefined ? { ...rawPulls, prs: rawPulls.prs.filter((p) => p.closed <= opts.asOf!) } : rawPulls;
  const asOf = opts.asOf ?? Date.now() / 1000;
  const view = buildView(data, period, rangeStart(data, range), kind, pulls, excludeBulk, opts.asOf);

  const meta = {
    repo: data.repo,
    source: data.source,
    branch: data.branch,
    analyzedAt: new Date(data.fetchedAt).toISOString(),
    classifier: data.classifier,
    params: { period, range, kind, excludeBulk, asOf: opts.asOf === undefined ? null : new Date(opts.asOf * 1000).toISOString() },
    releaseStyle: data.releaseStyle,
    /** per-repository rules this analysis used: release tag rules, vendored paths left out of size and lines added, agent names for this repository only */
    rulesApplied: data.appliedRules ?? { release: null, vendored: [], agents: null },
    tagCounts: tagCounts(data),
    /** what produced these numbers; buildFullReport adds headAtAsOf and analysisSchema */
    provenance: {
      toolVersion: pkg.version,
      classifier: data.classifier,
      releaseRulesId: data.releaseRulesId,
      vendoredId: data.vendoredId ?? "",
      asOf: opts.asOf === undefined ? null : new Date(opts.asOf * 1000).toISOString(),
      analysedSha: data.headSha ?? null,
      pinned: !!data.pinned,
      headAtAsOf: null as { sha: string; committedAt: string } | null,
      analysisSchema: null as number | null,
      note: "Same asOf and same analysed commit give the same numbers while the rule files are unchanged. Rewritten history (force pushes) or a different rule file can still change results.",
    },
    notes: [
      "AI share uses a strict allowlist plus overrides in agents.config.json, so it is a lower bound.",
      "codeLines is source code only, measured from the tree at the end of each month by file type: tests, docs (including everything under docs/), data/config and other files are reported separately in codeBreakdown. It is not distorted by how commits were squashed or split.",
      excludeBulk
        ? `Commits over ${data.bulkLines} counted lines are left out of linesAdded/linesDeleted and per-commit stats (excludeBulk=true). Code size is unaffected.`
        : `Large commits (over ${data.bulkLines} lines) are included in linesAdded/linesDeleted. They are often real squash-merged features; see the bulk section. Code size is unaffected.`,
      "Releases are main-line version tags only; monorepo package tags are ignored.",
      ...(opts.asOf === undefined ? [] : ["asOf is set: later commits, tags and merges are ignored. Code size is the latest month-end snapshot at or before asOf."]),
    ],
  };
  if (!view) return { meta, empty: true as const };

  const out: Record<string, unknown> = { meta };
  const add = (s: Section, build: (v: View) => unknown) => {
    if (want.has(s)) out[s] = build(view);
  };

  add("summary", (v) => ({
    commits: v.commits,
    contributors: v.contributorCount,
    firstCommit: iso(v.firstDate),
    ageDays: v.ageDays,
    aiAssistedCommits: v.aiCommits,
    aiSharePct: round(v.aiShare),
    aiCategory: v.aiCategory,
    botCommits: v.botCommits,
    codeLines: v.loc,
    codeBreakdown: v.locBreakdown,
    linesAdded: v.added,
    linesDeleted: v.deleted,
    meanHoursBetweenCommits: round(v.meanGap),
  }));

  add("timeline", (v) =>
    v.buckets.map((b) => ({
      period: b.key,
      commits: b.commits,
      contributors: b.contributors,
      linesAdded: b.added,
      linesDeleted: b.deleted,
      codeLines: b.loc,
      codeBreakdown: b.locBreakdown,
      aiCommits: b.aiCommits,
      botCommits: b.botCommits,
      meanHoursBetweenCommits: round(b.avgGapHours),
      medianHoursBetweenCommits: round(b.medianGapHours),
      stableReleases: b.stableReleases,
      preReleases: b.preReleases,
      rollingBuilds: b.rollingBuilds,
      meanDaysBetweenStableReleases: round(b.releaseGapDays),
    })),
  );

  add("velocity", (v) =>
    v.vel && {
      commitsPerDayNow: round(v.vel.current),
      commitsPerDayBefore: round(v.vel.previous),
      changePct: v.vel.change === null ? null : round(v.vel.change * 100),
      trend: v.vel.change === null ? "no-baseline" : v.vel.change > 0.1 ? "speeding-up" : v.vel.change < -0.1 ? "slowing-down" : "steady",
      series: v.vel.series.map((s) => ({ date: s.key, commitsPerDay: round(s.rate) })),
    },
  );

  add("releases", (v) => ({
    stable: v.stable.length,
    preReleaseBuilds: v.pre,
    packageTagsIgnored: v.packageTags,
    latestStable: v.stable.at(-1)?.name ?? null,
    style: v.releaseStyle,
    rollingBuildsInRange: v.rolling,
    stableTags: v.stable.map((r) => ({ name: r.name, date: new Date(r.t * 1000).toISOString() })),
  }));

  add("intervals", (v) =>
    v.intervals.map((r) => ({
      release: r.name,
      unreleased: r.unreleased,
      from: r.from,
      date: new Date(r.end * 1000).toISOString(),
      days: round(r.days),
      commits: r.commits,
      commitsPerDay: round(r.commitsPerDay),
      contributors: r.contributors,
      linesAdded: r.added,
      linesDeleted: r.deleted,
      aiCommits: r.agentCommits,
      preBuilds: r.preBuilds,
    })),
  );

  add("pulls", (v) =>
    pulls
      ? {
          windowMonths: pulls.windowMonths,
          closedPullRequests: pulls.sampled,
          truncated: pulls.truncated,
          authenticated: pulls.authenticated,
          medianDaysToMerge: round(v.prMedianDays),
          perPeriod: v.pr,
        }
      : { loaded: false, hint: "Pass pulls=true to include pull request stats (uses the GitHub API)." },
  );

  add("people", (v) => ({ kind, contributors: v.table.slice(0, limit), total: v.table.length }));

  add("ai", (v) => ({
    sharePct: round(v.aiShare),
    category: v.aiCategory,
    assistedCommits: v.aiCommits,
    sinceFirstAiCommit: v.adoption && {
      date: iso(v.adoption.date),
      commits: v.adoption.commits,
      sharePct: round(v.adoption.share),
      reliable: v.adoption.reliable,
    },
    medianLinesAddedPerCommit: v.medianAdd,
    busFactor12Months: v.busFactor,
    instructionFiles: v.agentFiles.map((f) => ({ tool: f.tool, path: f.path, files: f.files, firstSeen: f.addedAt ? new Date(f.addedAt * 1000).toISOString() : null })),
  }));

  add("detection", (v) => v.detection);

  add("bulk", (v) => v.bulk);

  add("pulse", (v) => {
    const st = projectStatus(data, asOf, opts.status);
    return { ...v.pulse, status: st.status, lastCommit: st.lastCommit, lastRelease: st.lastRelease, lastReleaseKind: st.lastReleaseKind, thresholds: st.thresholds };
  });

  add("stability", (v) => v.stability);

  add("quarters", () => ({ definition: QUARTER_DEFINITION, quarters: quarters(data, asOf, opts.quarters) }));

  add("mergeStyle", (v) => v.mergeStyle);

  add("heatmap", (v) => ({ rows: "Mon..Sun", columns: "hour 0..23 UTC", grid: v.grid }));

  return out;
}

function round(n: number | null | undefined, d = 2): number | null {
  return n === null || n === undefined || Number.isNaN(n) ? null : Number(n.toFixed(d));
}

export type Report = ReturnType<typeof buildReport>;
