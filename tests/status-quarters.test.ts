import { describe, expect, it } from "vitest";
import { quarters } from "../lib/quarters";
import { projectStatus } from "../lib/status";
import type { Analysis, CommitRow, ReleaseRow } from "../lib/types";

const DAY = 86400;
const utc = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h) / 1000;

function analysis(over: Partial<Analysis> = {}): Analysis {
  return {
    repo: "acme/widget",
    source: "https://github.com/acme/widget.git",
    branch: "main",
    fetchedAt: 0,
    classifier: "t",
    releaseRulesId: "t",
    bulkLines: 5000,
    snapshots: [],
    authors: ["Ann", "dependabot[bot]"],
    botAuthors: [1],
    aiAuthors: [],
    agents: [],
    commits: [],
    releases: [],
    releaseStyle: "semver",
    packageTags: 0,
    mergeTimes: [],
    agentFiles: [],
    bulk: [],
    unrecognized: [],
    ...over,
  };
}
const commit = (t: number, extra: Partial<CommitRow> = {}): CommitRow => ({ t, a: 0, add: 10, del: 0, ag: [], ...extra });
const stable = (name: string, t: number): ReleaseRow => ({ name, t, pre: false, stable: true, rolling: false });
const build = (name: string, t: number): ReleaseRow => ({ name, t, pre: false, stable: false, rolling: true });

describe("projectStatus", () => {
  const now = utc(2026, 10, 30);

  it("is releasing when a stable release is recent, whatever the commits say", () => {
    const d = analysis({ commits: [commit(now - 400 * DAY)], releases: [stable("v1.0.0", now - 100 * DAY)] });
    expect(projectStatus(d, now).status).toBe("releasing");
  });

  it("is developing when there are recent human commits but no recent release", () => {
    const d = analysis({ commits: [commit(now - 10 * DAY)], releases: [stable("v1.0.0", now - 300 * DAY)] });
    const s = projectStatus(d, now);
    expect(s.status).toBe("developing");
    expect(s.lastRelease).toBe(new Date((now - 300 * DAY) * 1000).toISOString());
  });

  it("is quiet when neither a release nor a commit is recent", () => {
    const d = analysis({ commits: [commit(now - 120 * DAY)], releases: [stable("v1.0.0", now - 300 * DAY)] });
    expect(projectStatus(d, now).status).toBe("quiet");
  });

  it("works for a repository with no releases at all", () => {
    expect(projectStatus(analysis({ commits: [commit(now - 5 * DAY)] }), now)).toMatchObject({ status: "developing", lastRelease: null, daysSinceRelease: null });
    expect(projectStatus(analysis({ commits: [commit(now - 500 * DAY)] }), now).status).toBe("quiet");
    expect(projectStatus(analysis(), now)).toMatchObject({ status: "quiet", lastCommit: null });
  });

  it("counts a rolling build as a release, but not a pre-release or a bot commit", () => {
    const rolling = analysis({ commits: [commit(now - 300 * DAY)], releases: [build("b1234", now - 2 * DAY)] });
    expect(projectStatus(rolling, now)).toMatchObject({ status: "releasing", lastReleaseKind: "rolling-build" });

    const pre: ReleaseRow = { name: "v2.0.0-rc.1", t: now - 2 * DAY, pre: true, stable: false, rolling: false };
    const onlyPre = analysis({ commits: [commit(now - 300 * DAY)], releases: [pre] });
    expect(projectStatus(onlyPre, now).status).toBe("quiet");

    const botOnly = analysis({ commits: [commit(now - 3 * DAY, { a: 1, bot: 1 })] });
    expect(projectStatus(botOnly, now).status).toBe("quiet");
  });

  it("takes thresholds as options, inclusive at the boundary", () => {
    const d = analysis({ commits: [commit(now - 100 * DAY)], releases: [stable("v1.0.0", now - 200 * DAY)] });
    expect(projectStatus(d, now).status).toBe("quiet");
    expect(projectStatus(d, now, { activeDays: 100 }).status).toBe("developing");
    expect(projectStatus(d, now, { releasingDays: 200 }).status).toBe("releasing");
    expect(projectStatus(d, now, { releasingDays: 200 }).thresholds).toEqual({ releasingDays: 200, activeDays: 90 });
  });
});

describe("quarters", () => {
  it("puts a tag made exactly at a quarter start in the new quarter, and returns the last N quarters oldest first", () => {
    const d = analysis({
      commits: [commit(utc(2025, 1, 5))],
      releases: [stable("v1.0.0", utc(2026, 6, 30, 23)), stable("v1.1.0", utc(2026, 7, 1, 0)), stable("v1.2.0", utc(2026, 9, 30, 23))],
    });
    const rows = quarters(d, utc(2026, 9, 30, 23) + 3599, { count: 3 });
    expect(rows.map((r) => r.quarter)).toEqual(["2026-Q1", "2026-Q2", "2026-Q3"]);
    expect(rows.map((r) => r.stableReleases)).toEqual([0, 1, 2]);
    expect(rows[2].releases).toEqual(["v1.1.0", "v1.2.0"]);
    expect(rows[2].complete).toBe(true);
  });

  it("includes a leap day in Q1 and crosses the year boundary", () => {
    const d = analysis({
      commits: [commit(utc(2023, 5, 1))],
      releases: [stable("v1.0.0", utc(2024, 2, 29, 12)), stable("v1.1.0", utc(2024, 3, 1, 12))],
    });
    const rows = quarters(d, utc(2024, 3, 31, 23), { count: 6 });
    expect(rows[0].quarter).toBe("2022-Q4");
    expect(rows.at(-1)?.quarter).toBe("2024-Q1");
    const q1 = rows.at(-1)!;
    expect(q1.stableReleases).toBe(2);
    // 1 March 12:00 minus 29 February 12:00
    expect(q1.medianDaysBetweenReleases).toBe(1);
    expect(q1.end).toBe("2024-03-31T23:59:59.000Z");
  });

  it("reports the wait at quarter end only for a quarter without a release", () => {
    const d = analysis({ commits: [commit(utc(2025, 1, 1))], releases: [stable("v1.0.0", utc(2026, 1, 1))] });
    const [q1, q2] = quarters(d, utc(2026, 6, 30, 23) + 3599, { count: 2 });
    expect(q1.waitAtQuarterEndDays).toBeNull();
    expect(q2.stableReleases).toBe(0);
    expect(q2.waitAtQuarterEndDays).toBe(181); // 1 Jan to 1 Jul 2026
  });

  it("leaves the wait empty when nothing was ever released, and counts rolling builds apart from releases", () => {
    const d = analysis({ commits: [commit(utc(2026, 1, 1))], releases: [build("b100", utc(2026, 5, 1)), build("b101", utc(2026, 5, 20))] });
    const [q2] = quarters(d, utc(2026, 6, 30, 23), { count: 1 });
    expect(q2).toMatchObject({ stableReleases: 0, waitAtQuarterEndDays: null, rollingBuilds: 2 });
  });

  it("takes sizes from the last snapshot before each edge and flags a large change", () => {
    const snap = (t: number, loc: number) => ({ t, loc, tests: 0, docs: 0, data: 0, other: 0 });
    const d = analysis({
      commits: [commit(utc(2025, 12, 1))],
      snapshots: [snap(utc(2025, 12, 31, 23) + 3599, 10_000), snap(utc(2026, 3, 31, 23) + 3599, 12_000), snap(utc(2026, 6, 30, 23) + 3599, 6_000)],
    });
    const [q1, q2] = quarters(d, utc(2026, 6, 30, 23) + 3599, { count: 2 });
    expect(q1).toMatchObject({ sourceLinesStart: 10_000, sourceLinesEnd: 12_000, netSourceChange: 2000, growthPct: 20, largeChange: false });
    expect(q2).toMatchObject({ sourceLinesStart: 12_000, sourceLinesEnd: 6_000, netSourceChange: -6000, growthPct: -50, largeChange: true });
  });

  it("says the current quarter is incomplete and which snapshot its end size came from", () => {
    const snap = (t: number, loc: number) => ({ t, loc, tests: 0, docs: 0, data: 0, other: 0 });
    const d = analysis({
      commits: [commit(utc(2026, 1, 1))],
      snapshots: [snap(utc(2026, 3, 31, 23) + 3599, 100), snap(utc(2026, 4, 30, 23) + 3599, 150)],
    });
    const [q2] = quarters(d, utc(2026, 5, 15), { count: 1 });
    expect(q2).toMatchObject({ complete: false, sourceLinesEnd: 150, sourceLinesEndMeasuredAt: "2026-04-30T23:59:59.000Z" });
  });
});
