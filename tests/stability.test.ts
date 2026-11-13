import { describe, expect, it } from "vitest";
import { mergeStyle, stability } from "../lib/stability";
import type { Analysis, CommitRow, ReleaseRow } from "../lib/types";

const DAY = 86400;
const T0 = Date.UTC(2025, 0, 1) / 1000;
const at = (day: number) => T0 + day * DAY;

const rel = (name: string, day: number): ReleaseRow => ({ name, t: at(day), pre: false, stable: true, rolling: false });

function analysis(over: Partial<Analysis> = {}): Analysis {
  // one counted commit per day for 90 days
  const commits: CommitRow[] = Array.from({ length: 90 }, (_, i) => ({ t: at(i), a: 0, add: 10, del: 1, ag: [] }));
  return {
    repo: "acme/widget",
    source: "https://github.com/acme/widget.git",
    branch: "main",
    fetchedAt: 0,
    classifier: "t",
    releaseRulesId: "t",
    bulkLines: 5000,
    snapshots: [],
    authors: ["Ann"],
    botAuthors: [],
    aiAuthors: [],
    agents: ["Claude"],
    commits,
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

describe("stability", () => {
  const releases = [
    rel("v1.0.0", 0),
    rel("v1.0.1", 3), // fixes v1.0.0 in 3 days
    rel("v1.1.0", 20),
    rel("v1.1.1", 22), // fixes v1.1.0 in 2 days
    rel("v1.2.0", 40),
    rel("v1.2.1", 60), // too late: 20 days
    rel("v2.0.0", 80),
  ];
  const s = stability(analysis({ releases }), at(90));

  it("detects patch-style versions and counts releases in the 12-month window", () => {
    expect(s.versionStyle).toBe("patch");
    expect(s.releases).toEqual({ last12Months: 7, previous12Months: 0 });
    expect(s.latestStable).toBe("v2.0.0");
  });

  it("measures days between releases and commits in each", () => {
    // intervals 3, 17, 2, 18, 20, 20 -> median 17.5
    expect(s.medianDaysBetween).toBe(17.5);
    expect(s.commitsPerRelease.max).toBeGreaterThanOrEqual(19);
    expect(s.commitsPerRelease.releasesOver50Commits).toBe(0);
  });

  it("counts feature releases fixed within 7 days, and new majors", () => {
    expect(s.fixedWithin7Days).toEqual({ applicable: true, featureReleases: 4, fixed: 2 });
    expect(s.newMajors).toEqual(["v1.0.0", "v2.0.0"]);
    expect(s.preOnePointZero).toBe(false);
  });

  it("counts commits since the latest release, ignoring bots and version bumps", () => {
    const commits: CommitRow[] = [
      { t: at(81), a: 0, add: 1, del: 0, ag: [] },
      { t: at(82), a: 1, add: 1, del: 0, ag: [], bot: 1 },
      { t: at(83), a: 0, add: 1, del: 0, ag: [], x: 1 },
      { t: at(84), a: 0, add: 1, del: 0, ag: [0] },
    ];
    const r = stability(analysis({ releases, commits }), at(90));
    expect(r.unreleasedCommits).toBe(2);
  });

  it("uses the AI share definition of the dashboard (no bots, no reverts or bumps)", () => {
    const commits: CommitRow[] = [
      { t: at(1), a: 0, add: 1, del: 0, ag: [0] },
      { t: at(2), a: 0, add: 1, del: 0, ag: [] },
      { t: at(3), a: 1, add: 1, del: 0, ag: [0], bot: 1 }, // bot: out of the denominator
      { t: at(4), a: 0, add: 1, del: 0, ag: [], x: 1 }, // revert: out of the denominator
    ];
    expect(stability(analysis({ releases, commits }), at(90)).aiSharePct.last12Months).toBe(50);
  });

  it("does not claim 'fixed within 7 days' for minor-bump projects", () => {
    const minorBump = [rel("v1.0.0", 0), rel("v1.1.0", 10), rel("v1.2.0", 20), rel("v1.3.0", 30), rel("v1.4.0", 40)];
    const r = stability(analysis({ releases: minorBump }), at(90));
    expect(r.versionStyle).toBe("minor-bump");
    expect(r.fixedWithin7Days.applicable).toBe(false);
  });

  it("recognises calendar versions and does not invent major releases for them", () => {
    const cal = [rel("v2026.101.0", 0), rel("v2026.115.0", 14), rel("v2026.201.0", 30), rel("v2026.215.0", 44)];
    const r = stability(analysis({ releases: cal }), at(90));
    expect(r.versionStyle).toBe("calendar");
    expect(r.newMajors).toEqual([]);
    expect(r.preOnePointZero).toBeNull();
  });

  it("reports rolling-build projects by builds, not numbered releases", () => {
    const builds: ReleaseRow[] = Array.from({ length: 30 }, (_, i) => ({ name: `b${1000 + i}`, t: at(i * 2), pre: false, stable: false, rolling: true }));
    const r = stability(analysis({ releases: builds, releaseStyle: "rolling-builds" }), at(90));
    expect(r.versionStyle).toBe("rolling-builds");
    expect(r.buildsLast12Months).toBe(30);
  });

  it("handles a project with no releases", () => {
    const r = stability(analysis({ releases: [], releaseStyle: "none" }), at(90));
    expect(r.latestStable).toBeNull();
    expect(r.medianDaysBetween).toBeNull();
    expect(r.unreleasedCommits).toBeNull();
  });
});

describe("mergeStyle", () => {
  it("flags a shift to squash merging, so a commit-count drop is not read as a slowdown", () => {
    const y = (year: number) => Date.UTC(year, 5, 1) / 1000;
    const commits: CommitRow[] = [
      ...Array.from({ length: 100 }, (_, i) => ({ t: y(2024) + i, a: 0, add: 1, del: 0, ag: [] })),
      ...Array.from({ length: 40 }, (_, i) => ({ t: y(2025) + i, a: 0, add: 1, del: 0, ag: [], sq: 1 as const })),
    ];
    const mergeTimes = Array.from({ length: 30 }, (_, i) => y(2024) + i);
    const m = mergeStyle(analysis({ commits, mergeTimes }));
    expect(m.years).toEqual([
      { year: 2024, commits: 100, squashPct: 0, mergeCommits: 30, mergeCommitsPer100: 30 },
      { year: 2025, commits: 40, squashPct: 100, mergeCommits: 0, mergeCommitsPer100: 0 },
    ]);
    expect(m.note).toMatch(/not comparable/);
  });

  it("says counts are comparable when the style is steady", () => {
    const commits: CommitRow[] = Array.from({ length: 10 }, (_, i) => ({ t: T0 + i * DAY, a: 0, add: 1, del: 0, ag: [], sq: 1 as const }));
    expect(mergeStyle(analysis({ commits })).note).toMatch(/comparable across years/);
  });
});

describe("commits per release for generated SDKs", () => {
  it("counts bot commits separately, so a Stainless-style SDK does not look like 1 commit per release", () => {
    // 3 releases, 20 days apart; between releases there are 12 bot commits (generated code) and 1 human commit
    const commits: CommitRow[] = [];
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 12; i++) commits.push({ t: at(r * 20 + 1 + i * 0.5), a: 1, add: 500, del: 10, ag: [], bot: 1 });
      commits.push({ t: at(r * 20 + 15), a: 0, add: 5, del: 0, ag: [] });
    }
    const releases = [rel("v1.0.0", 0), rel("v1.1.0", 20), rel("v1.2.0", 40), rel("v1.3.0", 60)];
    const s = stability(analysis({ releases, commits: commits.sort((x, y) => x.t - y.t) }), at(70));
    expect(s.commitsPerRelease.median).toBe(1); // people only
    expect(s.commitsPerRelease.includingBots.median).toBe(13); // everything that shipped
  });
});
