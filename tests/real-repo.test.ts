import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyze, changedDirectories, headAtOrBefore } from "../lib/git";
import { buildFullReport } from "../lib/full-report";
import { parseAsOf } from "../lib/report";

// A real git repository built on disk with fixed dates, so the git-derived parts (head sha, --pin, tag counts,
// quarterly size from month-end trees, the "which directory moved" hint) are tested against actual git output.
//
//   2026-01-10  src/core/main.ts (1000 lines), README.md                 tag v1.0.0
//   2026-02-15  src/engine/big.ts (+6000 lines)
//   2026-04-20  src/engine/big.ts removed (-6000)                         tag pkg@1.0.0 (a package tag)
//   2026-05-10  src/core/extra.ts (+50)                                   tag v1.1.0
//   2026-08-05  src/core/more.ts (+200)                                   tag v1.2.0
//   2026-10-02  src/core/small.ts (+10)                                   tag latest (not a version)

let dir = "";
const sha: Record<string, string> = {};

function git(args: string[], date?: string) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Ann Dev",
    GIT_AUTHOR_EMAIL: "ann@example.com",
    GIT_COMMITTER_NAME: "Ann Dev",
    GIT_COMMITTER_EMAIL: "ann@example.com",
    ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
  };
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: dir, env, encoding: "utf8" }).trim();
}

function lines(n: number) {
  return Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";
}

function commit(date: string, files: Record<string, string | null>, tags: string[] = []) {
  for (const [f, body] of Object.entries(files)) {
    const p = path.join(dir, f);
    if (body === null) rmSync(p);
    else {
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, body);
    }
  }
  git(["add", "-A"]);
  git(["commit", "-m", `change on ${date}`], date);
  const head = git(["rev-parse", "HEAD"]);
  for (const t of tags) git(["tag", t]);
  return head;
}

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ga-real-"));
  git(["init", "-q", "-b", "main"]);
  sha.jan = commit("2026-01-10T12:00:00Z", { "src/core/main.ts": lines(1000), "README.md": "# demo\n" }, ["v1.0.0"]);
  sha.feb = commit("2026-02-15T12:00:00Z", { "src/engine/big.ts": lines(6000) });
  sha.apr = commit("2026-04-20T12:00:00Z", { "src/engine/big.ts": null }, ["pkg@1.0.0"]);
  sha.may = commit("2026-05-10T12:00:00Z", { "src/core/extra.ts": lines(50) }, ["v1.1.0"]);
  sha.aug = commit("2026-08-05T12:00:00Z", { "src/core/more.ts": lines(200) }, ["v1.2.0"]);
  sha.oct = commit("2026-10-02T12:00:00Z", { "src/core/small.ts": lines(10) }, ["latest"]);
}, 60_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const asOf = parseAsOf("2026-10-30");

describe("analysis of a real repository", () => {
  it("records the commit it analysed, and counts what every tag turned out to be", async () => {
    const data = await analyze(dir);
    expect(data.headSha).toBe(sha.oct);
    expect(data.pinned).toBe(false);
    const report = (await buildFullReport(data, null, { asOf, sections: ["summary"] })) as unknown as {
      meta: { tagCounts: Record<string, number>; releaseStyle: string; provenance: Record<string, unknown> };
    };
    expect(report.meta.tagCounts).toEqual({ stable: 3, pre: 0, rolling: 0, package: 1, ignored: 0, other: 1, duplicates: 0, total: 5 });
    expect(report.meta.releaseStyle).toBe("semver");
    expect(report.meta.provenance).toMatchObject({ analysedSha: sha.oct, pinned: false, asOf: "2026-10-30T23:59:59.000Z" });
    expect(report.meta.provenance.toolVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.meta.provenance.headAtAsOf).toMatchObject({ sha: sha.oct });
  });

  it("finds the head at asOf, not the branch tip, when asked about an earlier date", async () => {
    const data = await analyze(dir);
    const report = (await buildFullReport(data, null, { asOf: parseAsOf("2026-06-30"), sections: ["summary"] })) as unknown as {
      meta: { provenance: { headAtAsOf: { sha: string } | null } };
    };
    expect(report.meta.provenance.headAtAsOf?.sha).toBe(sha.may);
    expect((await headAtOrBefore(dir, parseAsOf("2025-12-31")))).toBeNull();
  });

  it("--pin analyses an older commit: later commits and tags are not counted, and the pin is recorded", async () => {
    const data = await analyze(dir, false, undefined, { pin: sha.feb.slice(0, 10) });
    expect(data.headSha).toBe(sha.feb);
    expect(data.pinned).toBe(true);
    expect(data.commits).toHaveLength(2);
    expect(data.releases.map((r) => r.name)).toEqual(["v1.0.0"]);
    expect(data.snapshots.at(-1)?.loc).toBe(7000);
  });

  it("rejects a pin that is not a commit of the repository", async () => {
    await expect(analyze(dir, false, undefined, { pin: "deadbeef" })).rejects.toThrow(/not a commit/);
    await expect(analyze(dir, false, undefined, { pin: "not-a-sha" })).rejects.toThrow(/must be a commit sha/);
  });
});

describe("quarters section on a real repository", () => {
  it("gives net source change from month-end trees, with the definition", async () => {
    const data = await analyze(dir);
    const r = (await buildFullReport(data, null, { asOf, sections: ["quarters"] })) as unknown as {
      quarters: { definition: Record<string, string>; quarters: Record<string, unknown>[] };
    };
    expect(r.quarters.definition.netSourceChange).toMatch(/tests, docs, data and other files excluded/);
    const [q1, q2, q3, q4] = r.quarters.quarters;

    expect(q1).toMatchObject({ quarter: "2026-Q1", complete: true, sourceLinesStart: 0, sourceLinesEnd: 7000, netSourceChange: 7000, growthPct: null, stableReleases: 1 });
    expect(q2).toMatchObject({ quarter: "2026-Q2", complete: true, sourceLinesStart: 7000, sourceLinesEnd: 1050, netSourceChange: -5950, stableReleases: 1, medianDaysBetweenReleases: 120 });
    expect(q3).toMatchObject({ quarter: "2026-Q3", complete: true, sourceLinesStart: 1050, sourceLinesEnd: 1250, netSourceChange: 200, growthPct: 19.05, medianDaysBetweenReleases: 87 });
    // the current quarter: incomplete, no release yet, and the wait runs to the end of asOf's day
    expect(q4).toMatchObject({ quarter: "2026-Q4", complete: false, stableReleases: 0, medianDaysBetweenReleases: null, rollingBuilds: 0, sourceLinesEnd: 1260 });
    expect(q4.waitAtQuarterEndDays).toBeCloseTo(86.5, 1);
  });

  it("reports commit line counts separately and under their own name", async () => {
    const data = await analyze(dir);
    const r = (await buildFullReport(data, null, { asOf, sections: ["quarters"] })) as unknown as { quarters: { quarters: { commitLinesAddedAllFileTypes: number }[] } };
    // Q1 added 1000 + 1 (README) + 6000 lines; this is gross activity, and differs from the net source change
    expect(r.quarters.quarters[0].commitLinesAddedAllFileTypes).toBe(7001);
  });

  it("names the directory behind a large change", async () => {
    const data = await analyze(dir);
    const r = (await buildFullReport(data, null, { asOf, sections: ["quarters"] })) as unknown as {
      quarters: { quarters: { quarter: string; largeChange: boolean; topChangedDirectories: { path: string; netSourceLines: number }[] | null }[] };
    };
    const byQ = Object.fromEntries(r.quarters.quarters.map((q) => [q.quarter, q]));
    expect(byQ["2026-Q2"].largeChange).toBe(true);
    expect(byQ["2026-Q2"].topChangedDirectories?.[0]).toEqual({ path: "src/engine", netSourceLines: -6000 });
    expect(byQ["2026-Q3"].largeChange).toBe(false);
    expect(byQ["2026-Q3"].topChangedDirectories).toBeNull();
  });

  it("changedDirectories sums net source lines per directory between two moments", async () => {
    const top = await changedDirectories(dir, "HEAD", parseAsOf("2026-01-31"), parseAsOf("2026-03-31"));
    expect(top).toEqual([{ path: "src/engine", netSourceLines: 6000 }]);
  });
});
