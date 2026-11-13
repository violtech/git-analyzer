import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withTimeout } from "../lib/git";
import { RateLimitError } from "../lib/github-client";
import { parseAsOf } from "../lib/report";
import { runSample, type SampleDeps } from "../lib/sample";
import type { Analysis } from "../lib/types";

// The batch logic (resume, partial failure, timeout, serial GitHub calls) with the analysis itself replaced,
// so it runs without a network or a clone.

const DAY = 86400;
const asOf = parseAsOf("2026-10-30");

let tmp = "";
let calls: string[] = [];
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "ga-sample-"));
  calls = [];
  writeFileSync(path.join(tmp, "list.json"), JSON.stringify({ repos: ["a/one", "b/two", "c/three"] }));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function fakeAnalysis(repo: string): Analysis {
  return {
    repo,
    source: `https://github.com/${repo}.git`,
    branch: "main",
    fetchedAt: 0,
    classifier: "c1",
    releaseRulesId: "r1",
    bulkLines: 5000,
    snapshots: [{ t: asOf - 40 * DAY, loc: 1000, tests: 0, docs: 0, data: 0, other: 0 }],
    authors: ["Ann"],
    botAuthors: [],
    aiAuthors: [],
    agents: [],
    commits: [{ t: asOf - 3 * DAY, a: 0, add: 5, del: 0, ag: [] }],
    releases: [{ name: "v1.0.0", t: asOf - 30 * DAY, pre: false, stable: true, rolling: false }],
    releaseStyle: "semver",
    packageTags: 0,
    mergeTimes: [],
    agentFiles: [],
    bulk: [],
    unrecognized: [],
  };
}

function deps(over: Partial<SampleDeps> = {}): Partial<SampleDeps> {
  return {
    analyze: async (repo) => {
      calls.push(repo);
      return fakeAnalysis(repo);
    },
    report: async (data) => ({ summary: { commits: 1, codeLines: 1000, aiSharePct: 0 }, ai: { instructionFiles: [] }, pulse: { status: "releasing" }, stability: { releases: { last12Months: 1 }, versionStyle: "patch", aiSharePct: {} }, meta: { repo: data.repo } }),
    rules: async () => ({ schema: 6, classifier: "c1", releaseRulesId: "r1" }),
    info: async () => ({ stars: 10 }) as never,
    ...over,
  };
}

const run = (over: Partial<Parameters<typeof runSample>[0]> = {}) => runSample({ list: path.join(tmp, "list.json"), outDir: path.join(tmp, "snapshots"), asOf, ...over });

describe("ga sample: resumable batch", () => {
  it("keeps going after one repository fails, and says which failed and why", async () => {
    const r = await run({
      deps: deps({
        analyze: async (repo) => {
          calls.push(repo);
          if (repo === "b/two") throw new Error("clone failed: repository not found");
          return fakeAnalysis(repo);
        },
      }),
    });
    expect(r.summary.succeeded).toEqual(["a/one", "c/three"]);
    expect(r.summary.failed).toEqual([{ repo: "b/two", reason: "clone failed: repository not found" }]);
    expect(r.rows.map((x) => x.status)).toEqual(["done", "failed", "done"]);
    expect(calls).toEqual(["a/one", "b/two", "c/three"]);
  });

  it("resumes: a second run only redoes what is missing", async () => {
    let broken = true;
    const d = deps({
      analyze: async (repo) => {
        calls.push(repo);
        if (repo === "b/two" && broken) throw new Error("network down");
        return fakeAnalysis(repo);
      },
    });
    await run({ deps: d });
    calls = [];
    broken = false;
    const second = await run({ deps: d });
    expect(calls).toEqual(["b/two"]);
    expect(second.summary).toEqual({ succeeded: ["b/two"], skipped: ["a/one", "c/three"], failed: [] });
    expect(second.rows.map((x) => x.status)).toEqual(["skipped", "done", "skipped"]);
    // the index lists every repository, with its figures, whether it was redone or skipped
    expect(second.rows[0]).toMatchObject({ repo: "a/one", ok: true, codeLines: 1000, stars: 10, projectStatus: "releasing" });
  });

  it("resumes after a killed run: the index of an interrupted run is marked incomplete and the finished files are reused", async () => {
    await run({ deps: deps() });
    const index = path.join(tmp, "snapshots", "2026-10", "index.json");
    expect(JSON.parse(readFileSync(index, "utf8")).complete).toBe(true);
    // simulate a kill after the first repository: half-written leftovers and a stale index
    writeFileSync(path.join(tmp, "snapshots", "2026-10", "b__two.json"), '{"repo": "b/two", "rep');
    writeFileSync(path.join(tmp, "snapshots", "2026-10", "c__three.json.tmp"), "{");
    calls = [];
    const r = await run({ deps: deps() });
    expect(calls).toEqual(["b/two"]);
    expect(r.summary.skipped).toEqual(["a/one", "c/three"]);
  });

  it("does not skip when asOf, the classifier or the release rules differ, or on --refresh", async () => {
    await run({ deps: deps() });
    calls = [];
    await run({ deps: deps({ rules: async () => ({ schema: 6, classifier: "c2", releaseRulesId: "r1" }) }) });
    expect(calls).toHaveLength(3);
    calls = [];
    await run({ deps: deps({ rules: async () => ({ schema: 6, classifier: "c2", releaseRulesId: "r2" }) }) });
    expect(calls).toHaveLength(3);
    calls = [];
    await run({ deps: deps({ rules: async () => ({ schema: 7, classifier: "c2", releaseRulesId: "r2" }) }) });
    expect(calls).toHaveLength(3);
    calls = [];
    await run({ deps: deps({ rules: async () => ({ schema: 7, classifier: "c2", releaseRulesId: "r2" }) }), asOf: parseAsOf("2026-10-15") });
    expect(calls).toHaveLength(3); // same month folder, different asOf
    calls = [];
    await run({ deps: deps({ rules: async () => ({ schema: 7, classifier: "c2", releaseRulesId: "r2" }) }), asOf: parseAsOf("2026-10-15"), refresh: true });
    expect(calls).toHaveLength(3);
  });

  it("redoes a repository whose snapshot lacks a requested section", async () => {
    await run({ deps: deps(), sections: ["summary"] });
    calls = [];
    await run({ deps: deps({ report: async () => ({ summary: {}, ai: {}, pulse: {}, stability: {}, timeline: [] }) }), sections: ["timeline"] });
    expect(calls).toHaveLength(3);
  });

  it("asks the report for the requested number of quarters, and for none of its own when not asked", async () => {
    const seen: unknown[] = [];
    const spy = deps({ report: async (data, opts) => (seen.push(opts.quarters), { summary: { commits: 1, codeLines: 1000, aiSharePct: 0 }, ai: { instructionFiles: [] }, pulse: { status: "releasing" }, stability: { releases: { last12Months: 1 }, versionStyle: "patch", aiSharePct: {} }, meta: { repo: data.repo } }) });
    await run({ deps: spy, quarters: 12 });
    expect(seen).toEqual([{ count: 12 }, { count: 12 }, { count: 12 }]);
    seen.length = 0;
    await run({ deps: spy, refresh: true });
    expect(seen).toEqual([undefined, undefined, undefined]);
  });

  it("stops a repository that runs too long, counts it as failed and carries on", async () => {
    const r = await run({
      timeoutMin: 0.0005, // 30 ms
      deps: deps({
        analyze: async (repo) => {
          calls.push(repo);
          if (repo === "a/one") return new Promise<Analysis>(() => {}); // never finishes
          return fakeAnalysis(repo);
        },
      }),
    });
    expect(r.summary.failed).toHaveLength(1);
    expect(r.summary.failed[0].reason).toMatch(/a\/one timed out/);
    expect(r.summary.succeeded).toEqual(["b/two", "c/three"]);
  });

  it("asks GitHub for repository facts one repository at a time, and stops asking once the budget is gone", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let n = 0;
    const r = await run({
      deps: deps({
        info: async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((res) => setTimeout(res, 5));
          inFlight--;
          if (++n === 2) throw new RateLimitError(Date.now() / 1000 + 600, "core");
          return { stars: 5 } as never;
        },
      }),
    });
    expect(maxInFlight).toBe(1);
    expect(n).toBe(2); // the third repository did not spend a request
    expect(r.rateLimited).toBe(true);
    expect(r.summary.failed).toEqual([]); // analyses all succeeded; only stars are missing
    expect(r.rows.map((x) => x.stars)).toEqual([5, null, null]);

    // a later run fills in the missing stars without redoing the first repository (it already has its stars)
    calls = [];
    const again = await run({ deps: deps() });
    expect(calls).toEqual(["b/two", "c/three"]);
    expect(again.rateLimited).toBe(false);
    expect(again.rows.map((x) => x.stars)).toEqual([5, 10, 10]);
  });
  it("with waitForRateLimit, pauses when most of the allowance is used, logs it, and carries on", async () => {
    const sleeps: number[] = [];
    let lowReads = 1; // the first budget read says 50 of 60 used; after the pause there is room again
    let infoCalls = 0;
    const r = await run({
      waitForRateLimit: true,
      deps: deps({
        budget: async () => (lowReads-- > 0 ? { limit: 60, remaining: 10, reset: Date.now() / 1000 + 100 } : { limit: 60, remaining: 60, reset: Date.now() / 1000 + 3600 }),
        sleep: async (ms) => void sleeps.push(ms),
        info: async () => (infoCalls++, { stars: 7 } as never),
      }),
    });
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(90_000);
    expect(infoCalls).toBe(3);
    expect(r.rateLimited).toBe(false);
    expect(r.rows.map((x) => x.stars)).toEqual([7, 7, 7]);
    const log = readFileSync(path.join(tmp, "snapshots", r.month, "collect.log"), "utf8");
    expect(log).toMatch(/PAUSE 83% of the GitHub allowance used \(10 of 60 left\)/);
    expect(log).toMatch(/RESUME/);
    expect(() => readFileSync(path.join(tmp, "snapshots", r.month, "collect-state.json"), "utf8")).toThrow(); // removed after the pause
  });

  it("with waitForRateLimit, waits for the reset when GitHub refuses a request, then retries", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const r = await run({
      waitForRateLimit: true,
      deps: deps({
        budget: async () => null,
        sleep: async (ms) => void sleeps.push(ms),
        info: async () => {
          if (++n === 1) throw new RateLimitError(Date.now() / 1000 + 50, "core");
          return { stars: 9 } as never;
        },
      }),
    });
    expect(sleeps).toHaveLength(1);
    expect(r.rateLimited).toBe(false);
    expect(r.rows.map((x) => x.stars)).toEqual([9, 9, 9]);
  });
});

describe("withTimeout", () => {
  it("returns the result when the work is fast and rejects when it is not", async () => {
    await expect(withTimeout(1000, "x", async () => 7)).resolves.toBe(7);
    await expect(withTimeout(20, "slow repo", () => new Promise(() => {}))).rejects.toThrow(/slow repo timed out/);
  });
});
