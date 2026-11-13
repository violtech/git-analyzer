import type { AuthorKind } from "./agents";
import type { Analysis, Bucket, Granularity, PullStats } from "./types";

const DAY = 86400;

function bucketStart(ts: number, g: Granularity): Date {
  const d = new Date(ts * 1000);
  switch (g) {
    case "week": {
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
    }
    case "month":
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    case "quarter":
      return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
    case "year":
      return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  }
}

function next(d: Date, g: Granularity): Date {
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  switch (g) {
    case "week": return new Date(Date.UTC(y, m, day + 7));
    case "month": return new Date(Date.UTC(y, m + 1, 1));
    case "quarter": return new Date(Date.UTC(y, m + 3, 1));
    case "year": return new Date(Date.UTC(y + 1, 0, 1));
  }
}

export function label(d: Date, g: Granularity): string {
  const y = d.getUTCFullYear();
  switch (g) {
    case "week": return d.toISOString().slice(0, 10);
    case "month": return `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    case "quarter": return `${y} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    case "year": return String(y);
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** sinceTs: only show buckets from this unix time on; LOC still accumulates from the first commit. */
export function aggregate(data: Analysis, g: Granularity, sinceTs = 0): Bucket[] {
  const { commits } = data;
  if (!commits.length) return [];

  const map = new Map<number, { c: number; add: number; del: number; people: Set<number>; gaps: number[]; ai: number; bot: number; stable: number; pre: number; roll: number; relGaps: number[] }>();
  let prev = commits[0].t;
  for (const c of commits) {
    const k = bucketStart(c.t, g).getTime();
    let b = map.get(k);
    if (!b) map.set(k, (b = { c: 0, add: 0, del: 0, people: new Set(), gaps: [], ai: 0, bot: 0, stable: 0, pre: 0, roll: 0, relGaps: [] }));
    b.c++;
    b.add += c.add;
    b.del += c.del;
    b.people.add(c.a);
    if (c.ag.length) b.ai++;
    if (c.bot) b.bot++;
    if (c !== commits[0]) b.gaps.push((c.t - prev) / 3600);
    prev = c.t;
  }

  let prevStable: number | null = null;
  for (const r of data.releases) {
    const k = bucketStart(r.t, g).getTime();
    let b = map.get(k);
    if (!b) map.set(k, (b = { c: 0, add: 0, del: 0, people: new Set(), gaps: [], ai: 0, bot: 0, stable: 0, pre: 0, roll: 0, relGaps: [] }));
    if (r.rolling) b.roll++;
    else if (r.pre) b.pre++;
    else if (r.stable) {
      b.stable++;
      if (prevStable !== null) b.relGaps.push((r.t - prevStable) / DAY);
      prevStable = r.t;
    }
  }

  const out: Bucket[] = [];
  // code size comes from tree snapshots (month ends); the cumulative diff sum is only a fallback
  const snaps = data.snapshots ?? [];
  let si = -1;
  let loc = 0;
  let breakdown = { source: 0, tests: 0, docs: 0, data: 0, other: 0 };
  const end = bucketStart(commits[commits.length - 1].t, g);
  for (let d = bucketStart(commits[0].t, g); d <= end; d = next(d, g)) {
    const b = map.get(d.getTime());
    const add = b?.add ?? 0, del = b?.del ?? 0;
    const bucketEnd = next(d, g).getTime() / 1000 - 1;
    if (snaps.length) {
      while (si + 1 < snaps.length && snaps[si + 1].t <= bucketEnd) si++;
      const sn = si >= 0 ? snaps[si] : null;
      loc = sn?.loc ?? 0;
      breakdown = sn ? { source: sn.loc, tests: sn.tests, docs: sn.docs, data: sn.data, other: sn.other } : { source: 0, tests: 0, docs: 0, data: 0, other: 0 };
    } else {
      loc += add - del;
      breakdown = { ...breakdown, source: loc };
    }
    if (d.getTime() / 1000 < sinceTs) continue;
    const days = Math.max(1, (next(d, g).getTime() - d.getTime()) / 1000 / DAY);
    out.push({
      key: label(d, g),
      start: d.getTime(),
      commits: b?.c ?? 0,
      added: add,
      deleted: del,
      net: add - del,
      loc,
      locBreakdown: breakdown,
      contributors: b?.people.size ?? 0,
      avgGapHours: b && b.gaps.length ? b.gaps.reduce((s, x) => s + x, 0) / b.gaps.length : null,
      medianGapHours: median(b?.gaps ?? []),
      commitsPerDay: (b?.c ?? 0) / days,
      aiCommits: b?.ai ?? 0,
      botCommits: b?.bot ?? 0,
      stableReleases: b?.stable ?? 0,
      preReleases: b?.pre ?? 0,
      rollingBuilds: b?.roll ?? 0,
      releaseGapDays: b && b.relGaps.length ? b.relGaps.reduce((x, y) => x + y, 0) / b.relGaps.length : null,
    });
  }
  return out;
}

export function contributors(data: Analysis, sinceTs = 0, kind: AuthorKind = "all") {
  // keyed by identity (author index / agent label), so two people who share a display name stay separate
  const m = new Map<string, { name: string; commits: number; add: number; del: number }>();
  const bump = (key: string, name: string, c: { add: number; del: number }) => {
    const r = m.get(key) ?? { name, commits: 0, add: 0, del: 0 };
    r.commits++; r.add += c.add; r.del += c.del;
    m.set(key, r);
  };
  const botSet = new Set(data.botAuthors);
  const aiSet = new Set(data.aiAuthors);
  for (const c of data.commits) {
    if (c.t < sinceTs) continue;
    if (kind === "ai") {
      for (const i of c.ag) bump("g:" + data.agents[i], data.agents[i], c);
    } else if (kind === "bots") {
      if (botSet.has(c.a)) bump("a:" + c.a, data.authors[c.a], c);
    } else if (kind === "all" || (!botSet.has(c.a) && !aiSet.has(c.a))) {
      bump("a:" + c.a, data.authors[c.a], c);
    }
  }
  return [...m.values()].sort((x, y) => y.commits - x.commits);
}

export interface Velocity {
  series: { key: string; t: number; rate: number }[];
  current: number;
  previous: number;
  /** relative change of the latest 30 days vs the 30 days before; null if no baseline */
  change: number | null;
}

/** Rolling 30-day commits/day, sampled weekly, plus latest-30d vs previous-30d comparison. */
export function velocity(data: Analysis, sinceTs = 0): Velocity | null {
  const { commits } = data;
  if (commits.length < 2) return null;
  const W = 30 * DAY;
  const rate = (end: number) => {
    // commits in (end - W, end]
    let lo = 0, hi = commits.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (commits[mid].t <= end) lo = mid + 1; else hi = mid; }
    const upper = lo;
    lo = 0; hi = commits.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (commits[mid].t <= end - W) lo = mid + 1; else hi = mid; }
    return (upper - lo) / 30;
  };
  const last = commits[commits.length - 1].t;
  const first = Math.max(commits[0].t + W, sinceTs);
  const series: Velocity["series"] = [];
  for (let t = first; t <= last; t += 7 * DAY) series.push({ key: new Date(t * 1000).toISOString().slice(0, 10), t, rate: rate(t) });
  series.push({ key: new Date(last * 1000).toISOString().slice(0, 10), t: last, rate: rate(last) });
  const current = rate(last), previous = rate(last - W);
  return { series, current, previous, change: previous > 0 ? (current - previous) / previous : null };
}

/** [weekday 0=Mon..6][hour 0..23] commit counts (UTC) */
export function heatmap(data: Analysis, sinceTs = 0): number[][] {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const c of data.commits) {
    if (c.t < sinceTs) continue;
    const d = new Date(c.t * 1000);
    grid[(d.getUTCDay() + 6) % 7][d.getUTCHours()]++;
  }
  return grid;
}

export const fmtNum = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export function fmtHours(h: number | null): string {
  if (h === null) return "–";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

export interface PrBucket {
  key: string;
  merged: number;
  closed: number;
  /** median hours from PR creation to merge (null if nothing merged) */
  medianLeadHours: number | null;
}

/** Group pull requests by the period they were closed/merged in. */
export function aggregatePulls(prs: PullStats["prs"], g: Granularity, sinceTs = 0): PrBucket[] {
  const map = new Map<number, { merged: number; closed: number; lead: number[] }>();
  for (const p of prs) {
    if (p.closed < sinceTs) continue;
    const k = bucketStart(p.closed, g).getTime();
    const b = map.get(k) ?? { merged: 0, closed: 0, lead: [] };
    if (p.merged) {
      b.merged++;
      b.lead.push((p.closed - p.created) / 3600);
    } else b.closed++;
    map.set(k, b);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, b]) => ({ key: label(new Date(k), g), merged: b.merged, closed: b.closed, medianLeadHours: median(b.lead) }));
}

export { median };
