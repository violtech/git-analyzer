import { describe, expect, it } from "vitest";
import { buildReport, SECTIONS } from "../lib/report";
import type { Analysis, CommitRow } from "../lib/types";
import { buildView } from "../lib/view";

const DAY = 86400;
const T0 = Date.UTC(2025, 0, 6) / 1000;

function commit(i: number, extra: Partial<CommitRow> = {}): CommitRow {
  return { t: T0 + i * DAY, a: 0, add: 10, del: 2, ag: [], ...extra };
}

/** 10 commits: 3 AI-assisted, 1 bot, 1 bulk (50,000 lines). */
function fixture(): Analysis {
  const commits = [
    ...Array.from({ length: 6 }, (_, i) => commit(i)),
    commit(6, { ag: [0] }),
    commit(7, { ag: [0] }),
    commit(8, { ag: [0], b: 1, add: 50000, del: 0 }),
    commit(9, { a: 1, bot: 1 }),
  ];
  return {
    repo: "acme/widget",
    source: "https://github.com/acme/widget.git",
    branch: "main",
    fetchedAt: Date.UTC(2025, 1, 1),
    classifier: "test",
    releaseRulesId: "x",
    releaseStyle: "semver",
    mergeTimes: [],
    agentFiles: [],
    bulkLines: 5000,
    snapshots: [
      { t: T0 + 5 * DAY, loc: 1000, tests: 200, docs: 5000, data: 0, other: 0 },
      { t: T0 + 9 * DAY, loc: 60000, tests: 9000, docs: 80000, data: 300, other: 0 },
    ],
    authors: ["Ann", "dependabot[bot]"],
    botAuthors: [1],
    aiAuthors: [],
    agents: ["Claude"],
    commits,
    releases: [
      { name: "v1.0.0", t: T0 + 3 * DAY, pre: false, stable: true, rolling: false },
      { name: "v1.1.0", t: T0 + 8 * DAY, pre: false, stable: true, rolling: false },
      { name: "v1.2.0-rc.1", t: T0 + 8.5 * DAY, pre: true, stable: false, rolling: false },
    ],
    packageTags: 4,
    bulk: [{ h: "abc1234", t: T0 + 8 * DAY, a: 0, lines: 50000, s: "import vendor data" }],
    unrecognized: [{ name: "Some Person", count: 2 }],
  };
}

describe("buildReport", () => {
  it("returns every default section and records its parameters", () => {
    const r = buildReport(fixture(), null) as Record<string, unknown>;
    for (const s of SECTIONS.filter((x) => x !== "heatmap")) expect(r).toHaveProperty(s);
    expect(r).not.toHaveProperty("heatmap");
    expect((r.meta as { params: unknown }).params).toEqual({ period: "month", range: "all", kind: "all", excludeBulk: false, asOf: null });
  });

  it("matches the dashboard's own numbers (same buildView)", () => {
    const data = fixture();
    const view = buildView(data, "month", 0, "all", null, true)!;
    const r = buildReport(data, null, { sections: ["summary", "ai"] }) as { summary: Record<string, number>; ai: Record<string, number> };
    expect(r.summary.commits).toBe(view.commits);
    expect(r.summary.codeLines).toBe(view.loc);
    expect(r.ai.sharePct).toBeCloseTo(view.aiShare, 1);
  });

  it("leaves large commits in the line stats by default, excludes them on request, and says which", () => {
    const withBulk = buildReport(fixture(), null, { sections: ["summary"], excludeBulk: false }) as { summary: { linesAdded: number }; meta: { notes: string[] } };
    const without = buildReport(fixture(), null, { sections: ["summary"], excludeBulk: true }) as { summary: { linesAdded: number } };
    expect(withBulk.summary.linesAdded).toBeGreaterThan(50000);
    expect(without.summary.linesAdded).toBeLessThan(1000);
    expect(withBulk.meta.notes.join(" ")).toMatch(/included in linesAdded/);
  });

  it("measures code size from snapshots, so the large-commit toggle cannot change it", () => {
    const on = buildReport(fixture(), null, { sections: ["summary"], excludeBulk: true }) as { summary: { codeLines: number } };
    const off = buildReport(fixture(), null, { sections: ["summary"], excludeBulk: false }) as { summary: { codeLines: number } };
    expect(on.summary.codeLines).toBe(60000);
    expect(off.summary.codeLines).toBe(60000);
  });

  it("keeps bots out of the AI share and counts only stable releases", () => {
    const r = buildReport(fixture(), null, { sections: ["summary", "releases"] }) as {
      summary: { aiAssistedCommits: number; botCommits: number };
      releases: { stable: number; preReleaseBuilds: number; packageTagsIgnored: number };
    };
    expect(r.summary.aiAssistedCommits).toBe(3);
    expect(r.summary.botCommits).toBe(1);
    expect(r.releases).toMatchObject({ stable: 2, preReleaseBuilds: 1, packageTagsIgnored: 4 });
  });

  it("reports pull request stats as not loaded, with a hint, when none were fetched", () => {
    const r = buildReport(fixture(), null, { sections: ["pulls"] }) as { pulls: { loaded: boolean; hint: string } };
    expect(r.pulls.loaded).toBe(false);
    expect(r.pulls.hint).toMatch(/pulls/);
  });

  it("handles a repository with no commits", () => {
    const empty = { ...fixture(), commits: [] };
    expect(buildReport(empty, null)).toMatchObject({ empty: true });
  });
});

describe("--as-of", () => {
  it("parses a date as the end of that day (UTC) and rejects bad dates", async () => {
    const { parseAsOf } = await import("../lib/report");
    expect(parseAsOf("2026-10-30")).toBe(Date.UTC(2026, 9, 30, 23, 59, 59) / 1000);
    expect(parseAsOf("2026-02-31")).toBeNaN();
    expect(parseAsOf("30/10/2026")).toBeNaN();
    expect(parseAsOf("")).toBeNaN();
  });

  it("ignores everything after the date: commits, tags, code size, merges", async () => {
    const { atAsOf } = await import("../lib/view");
    const data = fixture();
    const cut = T0 + 5 * DAY + 100;
    const past = atAsOf({ ...data, mergeTimes: [T0, T0 + 9 * DAY] }, cut);
    expect(past.commits.every((c) => c.t <= cut)).toBe(true);
    expect(past.commits).toHaveLength(6);
    expect(past.releases.map((r) => r.name)).toEqual(["v1.0.0"]);
    expect(past.snapshots).toHaveLength(1);
    expect(past.mergeTimes).toEqual([T0]);
  });

  it("never reports a negative 'days since last commit' (llama.cpp case)", () => {
    const data = fixture();
    const asOf = T0 + 5 * DAY; // commits 6..9 are later than this
    const r = buildReport(data, null, { sections: ["pulse", "summary"], asOf }) as { pulse: { daysSinceCommit: number }; summary: { commits: number } };
    expect(r.pulse.daysSinceCommit).toBeGreaterThanOrEqual(0);
    expect(r.summary.commits).toBe(6);
  });

  it("records asOf in the report metadata", () => {
    const r = buildReport(fixture(), null, { sections: ["summary"], asOf: T0 + 5 * DAY }) as { meta: { params: { asOf: string } } };
    expect(r.meta.params.asOf).toBe(new Date((T0 + 5 * DAY) * 1000).toISOString());
  });
});

describe("code size by file type", () => {
  it("reports source lines as the headline and tests/docs/data beside it", () => {
    const r = buildReport(fixture(), null, { sections: ["summary"] }) as { summary: { codeLines: number; codeBreakdown: Record<string, number> } };
    expect(r.summary.codeLines).toBe(60000);
    expect(r.summary.codeBreakdown).toEqual({ source: 60000, tests: 9000, docs: 80000, data: 300, other: 0 });
  });

  it("counts AI-credited commits whose author is the agent itself", () => {
    const a = fixture();
    a.authors.push("Claude Code");
    a.aiAuthors = [2];
    a.commits.push(commit(10, { a: 2, ag: [0] }));
    const r = buildReport(a, null) as { detection: { years: { ai: number; authoredByAgent: number }[]; quarters: { quarter: string; base: number; ai: number; authoredByAgent: number; agents: [string, number][] }[] } };
    const y = r.detection.years[0];
    const q = r.detection.quarters[0];
    expect(q).toMatchObject({ quarter: "2025-Q1", ai: 4, authoredByAgent: 1 });
    expect(q.agents).toEqual([["Claude", 4]]);
    const mo = (r as unknown as { detection: { months: { month: string; ai: number; agents: [string, number][] }[] } }).detection.months;
    expect(mo.reduce((n, x) => n + x.ai, 0)).toBe(4);
    const lines = (r as unknown as { detection: { bulkLines: number; months: { addedBase: number; aiAdded: number; agentAdded: [string, number][] }[] } }).detection;
    // the bulk commit (50,000 lines) is left out of the lines; the other credited commits add 10 lines each
    expect(lines.bulkLines).toBe(5000);
    expect(lines.months.reduce((n, x) => n + x.aiAdded, 0)).toBe(30);
    expect(lines.months.reduce((n, x) => n + x.addedBase, 0)).toBe(90);
    expect(mo[0].agents).toEqual([["Claude", mo[0].ai]]);
    expect(q.base).toBeGreaterThan(q.ai);
    expect(y.authoredByAgent).toBe(1);
    expect(y.ai).toBe(4);
  });
});
