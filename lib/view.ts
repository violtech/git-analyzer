import { aggregate, aggregatePulls, contributors, heatmap, median, velocity } from "./aggregate";
import type { AuthorKind } from "./agents";
import { releaseIntervals } from "./releases";
import { projectStatus } from "./status";
import { mergeStyle, stability } from "./stability";
import type { Analysis, CommitRow, Granularity, PullStats } from "./types";

export type Range = "1" | "2" | "5" | "all";

const DAY = 86400;

/** Unix time the selected range starts at (0 = all history). */
export function rangeStart(data: Analysis, range: Range): number {
  if (range === "all") return 0;
  const last = data.commits[data.commits.length - 1]?.t ?? 0;
  return last - Number(range) * 365 * DAY;
}

/**
 * The analysis as it stood at a point in time: nothing that happened later is counted (commits, tags, merges, instruction
 * files). Code size comes from the latest month-end snapshot at or before that time.
 */
export function atAsOf(data: Analysis, asOf: number): Analysis {
  return {
    ...data,
    commits: data.commits.filter((c) => c.t <= asOf),
    snapshots: data.snapshots.filter((s) => s.t <= asOf),
    releases: data.releases.filter((r) => r.t <= asOf),
    mergeTimes: data.mergeTimes.filter((t) => t <= asOf),
    bulk: data.bulk.filter((b) => b.t <= asOf),
    agentFiles: data.agentFiles.filter((f) => f.addedAt === null || f.addedAt <= asOf),
    otherTags: data.otherTags && {
      package: data.otherTags.package.filter((t) => t <= asOf),
      ignored: data.otherTags.ignored.filter((t) => t <= asOf),
      other: data.otherTags.other.filter((t) => t <= asOf),
      duplicate: data.otherTags.duplicate.filter((t) => t <= asOf),
    },
    packageTags: data.otherTags ? data.otherTags.package.filter((t) => t <= asOf).length : data.packageTags,
  };
}

/** Same analysis with the line counts of bulk commits zeroed, so every chart agrees on one definition of growth. */
export function withoutBulkLines(data: Analysis): Analysis {
  return { ...data, commits: data.commits.map((c) => (c.b ? { ...c, add: 0, del: 0 } : c)) };
}

export type AiCategory = "none" | "experimental" | "limited" | "consistent" | "pervasive";

/** Adoption categories from "Agentic Much?" (Robbes et al., MSR 2026): <1%, 1-5%, 5-20%, >20%. */
export function aiCategory(sharePct: number): AiCategory {
  if (sharePct <= 0) return "none";
  if (sharePct < 1) return "experimental";
  if (sharePct < 5) return "limited";
  if (sharePct < 20) return "consistent";
  return "pervasive";
}

const isAi = (c: CommitRow) => c.ag.length > 0 && !c.bot;
/** commits that count toward the AI-share denominator: no bots, no reverts / version bumps */
const countsForShare = (c: CommitRow) => !c.bot && !c.x;

function pulse(data: Analysis, now: number) {
  const { commits, releases } = data;
  const human = commits.filter((c) => !c.bot);
  const lastCommit = human.at(-1)?.t ?? null;
  const lastRelease = releases.filter((r) => r.stable).at(-1)?.t ?? null;
  const within = (days: number) => human.filter((c) => c.t > now - days * DAY).length;
  return {
    // status first: the figures below keep their own definitions (daysSinceRelease here counts stable releases only)
    ...projectStatus(data, now),
    daysSinceCommit: lastCommit === null ? null : (now - lastCommit) / DAY,
    daysSinceRelease: lastRelease === null ? null : (now - lastRelease) / DAY,
    last90: within(90),
    last180: within(180),
    last365: within(365),
  };
}

/** Smallest number of people behind half of the last 12 months of commits (commit-based, not file ownership). */
function busFactor(data: Analysis) {
  const last = data.commits.at(-1)?.t ?? 0;
  const counts = new Map<number, number>();
  let total = 0;
  for (const c of data.commits) {
    if (c.bot || c.t <= last - 365 * DAY) continue;
    counts.set(c.a, (counts.get(c.a) ?? 0) + 1);
    total++;
  }
  let acc = 0;
  let n = 0;
  for (const v of [...counts.values()].sort((a, b) => b - a)) {
    acc += v;
    n++;
    if (acc >= total / 2) break;
  }
  return total ? { n, total, people: counts.size } : null;
}

/** Per calendar year: how many commits counted, how many were AI-assisted, and by which identities. */
function detectionByYear(data: Analysis) {
  const aiAuthors = new Set(data.aiAuthors);
  const years = new Map<number, { base: number; ai: number; authored: number; agents: Map<string, number> }>();
  for (const c of data.commits) {
    if (!countsForShare(c)) continue;
    const y = new Date(c.t * 1000).getUTCFullYear();
    const row = years.get(y) ?? { base: 0, ai: 0, authored: 0, agents: new Map<string, number>() };
    row.base++;
    if (isAi(c)) {
      row.ai++;
      // the agent is the commit's author (not only a Co-Authored-By trailer)
      if (aiAuthors.has(c.a)) row.authored++;
      for (const i of c.ag) row.agents.set(data.agents[i], (row.agents.get(data.agents[i]) ?? 0) + 1);
    }
    years.set(y, row);
  }
  return [...years.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, r]) => ({
      year,
      base: r.base,
      ai: r.ai,
      authoredByAgent: r.authored,
      share: r.base ? (r.ai / r.base) * 100 : 0,
      agents: [...r.agents.entries()].sort((a, b) => b[1] - a[1]),
    }));
}

/** The same counts per calendar quarter (e.g. "2026-Q3"): commits counted, AI-credited, and of those how many have the agent as author. */
function detectionByQuarter(data: Analysis) {
  const aiAuthors = new Set(data.aiAuthors);
  const quarters = new Map<string, { base: number; ai: number; authored: number; agents: Map<string, number> }>();
  for (const c of data.commits) {
    if (!countsForShare(c)) continue;
    const d = new Date(c.t * 1000);
    const key = `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    const row = quarters.get(key) ?? { base: 0, ai: 0, authored: 0, agents: new Map<string, number>() };
    row.base++;
    if (isAi(c)) {
      row.ai++;
      if (aiAuthors.has(c.a)) row.authored++;
      for (const i of c.ag) row.agents.set(data.agents[i], (row.agents.get(data.agents[i]) ?? 0) + 1);
    }
    quarters.set(key, row);
  }
  return [...quarters.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([quarter, r]) => ({ quarter, base: r.base, ai: r.ai, authoredByAgent: r.authored, agents: [...r.agents.entries()].sort((x, y) => y[1] - x[1]) }));
}

/**
 * Per calendar month (e.g. "2026-05"): AI-credited commits and the tools credited in each, plus the lines added. Lines leave out bulk
 * commits (squash-merged imports and the like), which would otherwise decide a month on their own.
 */
function detectionByMonth(data: Analysis) {
  type Row = { ai: number; agents: Map<string, number>; addedBase: number; aiAdded: number; agentAdded: Map<string, number> };
  const months = new Map<string, Row>();
  for (const c of data.commits) {
    if (!countsForShare(c)) continue;
    const d = new Date(c.t * 1000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const row = months.get(key) ?? { ai: 0, agents: new Map<string, number>(), addedBase: 0, aiAdded: 0, agentAdded: new Map<string, number>() };
    const lines = c.b ? 0 : c.add;
    row.addedBase += lines;
    if (isAi(c)) {
      row.ai++;
      row.aiAdded += lines;
      for (const i of c.ag) {
        const name = data.agents[i];
        row.agents.set(name, (row.agents.get(name) ?? 0) + 1);
        row.agentAdded.set(name, (row.agentAdded.get(name) ?? 0) + lines);
      }
    }
    months.set(key, row);
  }
  const sorted = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]);
  return [...months.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, r]) => ({ month, ai: r.ai, agents: sorted(r.agents), addedBase: r.addedBase, aiAdded: r.aiAdded, agentAdded: sorted(r.agentAdded) }));
}

/** Everything the dashboard tabs render, derived once from the raw analysis. */
export function buildView(
  raw: Analysis,
  g: Granularity,
  sinceTs: number,
  kind: AuthorKind,
  pulls: PullStats | null,
  excludeBulk = false,
  asOf = Date.now() / 1000,
) {
  if (!raw.commits.length) return null;
  const data = excludeBulk ? withoutBulkLines(raw) : raw;

  const buckets = aggregate(data, g, sinceTs);
  const scoped = data.commits.filter((c) => c.t >= sinceTs);
  const rawScoped = raw.commits.filter((c) => c.t >= sinceTs);
  const gaps = buckets.flatMap((b) => (b.avgGapHours === null ? [] : [b.avgGapHours]));
  const first = raw.commits[0].t;
  const last = raw.commits[raw.commits.length - 1].t;

  // AI share: AI-assisted / (all commits except bots and housekeeping)
  const base = scoped.filter(countsForShare);
  const aiCommits = base.filter(isAi).length;
  const aiShare = base.length ? (aiCommits / base.length) * 100 : 0;

  // From the first AI-assisted commit on: how pervasive AI became once it was adopted
  const firstAi = raw.commits.find((c) => isAi(c) && countsForShare(c));
  const post = firstAi ? raw.commits.filter((c) => c.t >= firstAi.t && countsForShare(c)) : [];
  const postShare = post.length ? (post.filter(isAi).length / post.length) * 100 : 0;

  // Median lines added per commit, AI-assisted vs human-only
  const human = base.filter((c) => !isAi(c)).map((c) => c.add);
  const ai = base.filter(isAi).map((c) => c.add);

  // Bulk commits (reported on the raw data, whatever the toggle says)
  const bulkRange = rawScoped.filter((c) => c.b);
  const totalNet = rawScoped.reduce((s, c) => s + c.add - c.del, 0);
  const bulkNet = bulkRange.reduce((s, c) => s + c.add - c.del, 0);

  return {
    buckets,
    churn: buckets.map((b) => ({ ...b, deleted: -b.deleted })),
    split: buckets.map((b) => ({
      ...b,
      ai: b.aiCommits,
      bots: b.botCommits,
      humans: Math.max(0, b.commits - b.aiCommits - b.botCommits),
    })),
    people: contributors(data, sinceTs),
    contributorCount: new Set(scoped.filter((c) => !c.bot).map((c) => c.a)).size,
    table: contributors(data, sinceTs, kind),
    grid: heatmap(data, sinceTs),
    vel: velocity(data, sinceTs),
    intervals: releaseIntervals(data, sinceTs),
    stable: data.releases.filter((r) => r.stable && r.t >= sinceTs),
    pre: data.releases.filter((r) => r.pre && r.t >= sinceTs).length,
    packageTags: data.packageTags,
    pr: pulls ? aggregatePulls(pulls.prs, g, sinceTs) : null,
    prMedianDays: pulls
      ? median(pulls.prs.filter((p) => p.merged && p.closed >= sinceTs).map((p) => (p.closed - p.created) / DAY))
      : null,
    commits: scoped.length,
    aiCommits,
    aiShare,
    aiCategory: aiCategory(aiShare),
    botCommits: scoped.filter((c) => c.bot).length,
    adoption: firstAi ? { date: new Date(firstAi.t * 1000), commits: post.length, share: postShare, reliable: post.length >= 10 } : null,
    medianAdd: { human: median(human), ai: median(ai) },
    added: scoped.reduce((s, c) => s + c.add, 0),
    deleted: scoped.reduce((s, c) => s + c.del, 0),
    meanGap: gaps.length ? gaps.reduce((s, x) => s + x, 0) / gaps.length : null,
    loc: buckets.at(-1)?.loc ?? 0,
    locBreakdown: buckets.at(-1)?.locBreakdown ?? { source: 0, tests: 0, docs: 0, data: 0, other: 0 },
    bulk: {
      count: bulkRange.length,
      lines: bulkRange.reduce((s, c) => s + c.add + c.del, 0),
      /** share of net growth in range that came from bulk commits; can exceed 100% when other work deletes more than it adds */
      netSharePct: totalNet !== 0 ? (bulkNet / Math.abs(totalNet)) * 100 : null,
      top: raw.bulk.filter((b) => b.t >= sinceTs).slice(0, 5),
      threshold: raw.bulkLines,
    },
    detection: { years: detectionByYear(raw), quarters: detectionByQuarter(raw), months: detectionByMonth(raw), bulkLines: raw.bulkLines, unrecognized: raw.unrecognized },
    pulse: pulse(raw, asOf),
    stability: stability(raw, asOf),
    mergeStyle: mergeStyle(raw),
    agentFiles: raw.agentFiles,
    releaseStyle: raw.releaseStyle,
    rolling: raw.releases.filter((r) => r.rolling && r.t >= sinceTs).length,
    busFactor: busFactor(raw),
    firstDate: new Date(first * 1000),
    ageDays: Math.round((last - first) / DAY),
  };
}

export type View = NonNullable<ReturnType<typeof buildView>>;
