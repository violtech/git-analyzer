import type { Analysis } from "./types";

const DAY = 86400;

export interface QuarterOptions {
  /** number of calendar quarters, ending with the one that contains asOf (default 4) */
  count?: number;
  /** a quarter is flagged `largeChange` when net source change is at least this share of its start size (default 20) ... */
  largePct?: number;
  /** ... and at least this many lines (default 5000) */
  largeLines?: number;
}

export const QUARTER_DEFINITION = {
  quarter:
    "Calendar quarter on UTC month boundaries: Q1 = Jan-Mar, Q2 = Apr-Jun, Q3 = Jul-Sep, Q4 = Oct-Dec. The last row is the quarter that contains asOf and is marked complete=false until it has ended.",
  netSourceChange:
    "sourceLinesEnd - sourceLinesStart: the change in source-language lines in the tree (tests, docs, data and other files excluded), measured from the tree at month ends. Removing vendored code or a generated folder lowers it. This is the growth measure to quote.",
  growthPct: "netSourceChange as a percentage of sourceLinesStart (null when the quarter starts at 0 lines).",
  commitLinesAddedAllFileTypes:
    "Sum of lines added by the quarter's commits across every non-ignored text file (source, tests, docs, data). It is gross activity, not growth, and is not comparable to netSourceChange.",
  medianDaysBetweenReleases:
    "Median gap in days between consecutive stable releases where the later release falls in the quarter; the earlier one may be in a previous quarter.",
  waitAtQuarterEndDays:
    "Only when the quarter has no stable release: days from the latest earlier stable release to the end of the quarter (or to asOf for the current quarter).",
  sizeMeasuredAt:
    "Sizes come from month-end snapshots; for the current, incomplete quarter the end size is the latest snapshot at or before asOf and can lag by up to a month.",
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const iso = (t: number) => new Date(t * 1000).toISOString();
const r2 = (n: number) => Number(n.toFixed(2));

/** Per-calendar-quarter release and source-size figures, from the same data the rest of the report uses. */
export function quarters(data: Analysis, asOf: number, opts: QuarterOptions = {}) {
  const count = opts.count ?? 4;
  const largePct = opts.largePct ?? 20;
  const largeLines = opts.largeLines ?? 5000;

  const stable = data.releases.filter((r) => r.stable && r.t <= asOf).sort((a, b) => a.t - b.t);
  const rolling = data.releases.filter((r) => r.rolling && r.t <= asOf);
  const snaps = data.snapshots.filter((s) => s.t <= asOf).sort((a, b) => a.t - b.t);
  const firstCommit = data.commits[0]?.t ?? null;

  /** latest snapshot taken strictly before t */
  const sizeBefore = (t: number) => snaps.filter((s) => s.t < t).at(-1) ?? null;

  const asOfDate = new Date(asOf * 1000);
  let y = asOfDate.getUTCFullYear();
  let q = Math.floor(asOfDate.getUTCMonth() / 3);
  const rows = [];
  for (let n = 0; n < count; n++) {
    const start = Date.UTC(y, q * 3, 1) / 1000;
    const end = Date.UTC(y, q * 3 + 3, 1) / 1000;
    const effEnd = Math.min(end, asOf + 1);
    const complete = end <= asOf + 1;

    const inQ = (t: number) => t >= start && t < end;
    const rel = stable.filter((r) => inQ(r.t));
    const gaps = rel.flatMap((r) => {
      const i = stable.indexOf(r);
      return i > 0 ? [(r.t - stable[i - 1].t) / DAY] : [];
    });
    const lastBefore = stable.filter((r) => r.t < start).at(-1) ?? null;

    const s0 = sizeBefore(start);
    const s1 = sizeBefore(effEnd);
    const existedAtStart = firstCommit !== null && firstCommit < start;
    const sourceStart = s0 ? s0.loc : firstCommit !== null && !existedAtStart ? 0 : null;
    const existedByEnd = firstCommit !== null && firstCommit < effEnd;
    const sourceEnd = s1 ? s1.loc : existedByEnd ? null : 0;
    const net = sourceStart !== null && sourceEnd !== null ? sourceEnd - sourceStart : null;
    const growth = net !== null && sourceStart ? (net / sourceStart) * 100 : null;

    const commits = data.commits.filter((c) => inQ(c.t));
    const med = median(gaps);
    rows.push({
      quarter: `${y}-Q${q + 1}`,
      start: iso(start),
      end: iso(end - 1),
      complete,
      stableReleases: rel.length,
      releases: rel.map((r) => r.name),
      medianDaysBetweenReleases: med === null ? null : r2(med),
      waitAtQuarterEndDays: rel.length === 0 && lastBefore ? r2((effEnd - lastBefore.t) / DAY) : null,
      rollingBuilds: rolling.filter((r) => inQ(r.t)).length,
      sourceLinesStart: sourceStart,
      sourceLinesEnd: sourceEnd,
      netSourceChange: net,
      growthPct: growth === null ? null : r2(growth),
      sourceLinesStartMeasuredAt: s0 ? iso(s0.t) : null,
      sourceLinesEndMeasuredAt: s1 ? iso(s1.t) : null,
      commits: commits.length,
      commitLinesAddedAllFileTypes: commits.reduce((s, c) => s + c.add, 0),
      largeChange: net !== null && Math.abs(net) >= largeLines && (sourceStart ? Math.abs(growth!) >= largePct : true),
      /** filled in by buildFullReport when the clone is on disk, for quarters flagged largeChange */
      topChangedDirectories: null as { path: string; netSourceLines: number }[] | null,
    });

    q--;
    if (q < 0) {
      q = 3;
      y--;
    }
  }
  return rows.reverse();
}

export type QuarterRow = ReturnType<typeof quarters>[number];
