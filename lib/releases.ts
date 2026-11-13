import type { Analysis } from "./types";

const DAY = 86400;

export interface ReleaseInterval {
  /** release that closes the interval; "Unreleased" for work after the last stable release */
  name: string;
  /** previous stable release (null for the first interval, which starts at the first commit) */
  from: string | null;
  start: number;
  end: number;
  days: number;
  commits: number;
  commitsPerDay: number;
  contributors: number;
  added: number;
  deleted: number;
  agentCommits: number;
  /** pre-release builds (canary, beta, ...) tagged inside the interval */
  preBuilds: number;
  unreleased: boolean;
}

/**
 * Splits history at each stable release tag. Commits are assigned by commit time
 * (previous.t < commit.t <= release.t), so it is an approximation of `git log prev..tag`.
 */
export function releaseIntervals(data: Analysis, sinceTs = 0): ReleaseInterval[] {
  const stable = data.releases.filter((r) => r.stable);
  const { commits } = data;
  if (!commits.length || !stable.length) return [];

  const lastCommit = commits[commits.length - 1].t;
  const bounds: { name: string; from: string | null; start: number; end: number; unreleased: boolean }[] = [];
  let prevT = commits[0].t - 1;
  let prevName: string | null = null;
  for (const r of stable) {
    bounds.push({ name: r.name, from: prevName, start: prevT, end: r.t, unreleased: false });
    prevT = r.t;
    prevName = r.name;
  }
  if (lastCommit > prevT) bounds.push({ name: "Unreleased", from: prevName, start: prevT, end: lastCommit, unreleased: true });

  const out: ReleaseInterval[] = [];
  let i = 0;
  for (const b of bounds) {
    while (i < commits.length && commits[i].t <= b.start) i++;
    const people = new Set<number>();
    let n = 0, added = 0, deleted = 0, agent = 0;
    for (let j = i; j < commits.length && commits[j].t <= b.end; j++) {
      const c = commits[j];
      n++; added += c.add; deleted += c.del;
      people.add(c.a);
      if (c.ag.length) agent++;
    }
    if (b.end < sinceTs) continue;
    const days = Math.max((b.end - b.start) / DAY, 1 / 24);
    out.push({
      name: b.name,
      from: b.from,
      start: b.start,
      end: b.end,
      days,
      commits: n,
      commitsPerDay: n / days,
      contributors: people.size,
      added,
      deleted,
      agentCommits: agent,
      preBuilds: data.releases.filter((r) => r.pre && r.t > b.start && r.t <= b.end).length,
      unreleased: b.unreleased,
    });
  }
  return out;
}
