import { githubJson, RateLimitError } from "./github-client";
import type { PullStats } from "./types";

const PAGE_TTL_MS = 6 * 3600 * 1000;
const PER_PAGE = 100;

interface ApiPull {
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
}

/**
 * Closed pull requests (merged or not). By default only the last 12 months, which keeps this to a
 * handful of API pages; `full` walks the whole history (capped by what the rate limit allows).
 * Pages are cached on disk by the shared client, so repeat loads cost no API budget.
 */
export async function fetchPulls(ownerRepo: string, full = false, months = 12): Promise<PullStats> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(ownerRepo)) throw new Error("Pull request stats need a GitHub repository");

  const token = !!process.env.GITHUB_TOKEN;
  const maxPages = full ? (token ? 100 : 25) : token ? 30 : 10;
  const cutoff = full ? 0 : Date.now() / 1000 - months * 30.4 * 86400;

  const prs: PullStats["prs"] = [];
  let truncated = false;
  let reachedCutoff = false;

  for (let page = 1; page <= maxPages && !reachedCutoff; page++) {
    let batch: ApiPull[];
    try {
      // sorted by last update: a PR closed inside the window is always updated inside it too
      batch = await githubJson<ApiPull[]>(
        `https://api.github.com/repos/${ownerRepo}/pulls?state=closed&sort=updated&direction=desc&per_page=${PER_PAGE}&page=${page}`,
        { ttlMs: PAGE_TTL_MS },
      );
    } catch (e) {
      if (e instanceof RateLimitError && prs.length) {
        truncated = true;
        break;
      }
      throw e;
    }
    for (const p of batch) {
      const end = p.merged_at ?? p.closed_at;
      if (!end) continue;
      const closed = Date.parse(end) / 1000;
      if (closed < cutoff) continue;
      prs.push({ created: Date.parse(p.created_at) / 1000, closed, merged: !!p.merged_at });
    }
    if (batch.length < PER_PAGE) break;
    if (cutoff && Date.parse(batch[batch.length - 1].updated_at) / 1000 < cutoff) reachedCutoff = true;
    else if (page === maxPages) truncated = true;
  }

  return {
    repo: ownerRepo,
    fetchedAt: Date.now(),
    sampled: prs.length,
    total: null,
    truncated,
    authenticated: token,
    windowMonths: full ? null : months,
    prs,
  };
}

export interface RepoInfo {
  repo: string;
  stars: number;
  forks: number;
  openIssues: number;
  createdAt: string;
  pushedAt: string;
  license: string | null;
  archived: boolean;
  isFork: boolean;
  defaultBranch: string;
  topics: string[];
  description: string | null;
}

interface ApiRepoInfo {
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  created_at: string;
  pushed_at: string;
  license: { spdx_id: string | null } | null;
  archived: boolean;
  fork: boolean;
  default_branch: string;
  topics?: string[];
  description: string | null;
}

/** Stars and basic facts: one API request per repository, cached for 12 hours. */
export async function fetchRepoInfo(ownerRepo: string): Promise<RepoInfo> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(ownerRepo)) throw new Error("Repository info needs a GitHub repository (owner/name)");
  const r = await githubJson<ApiRepoInfo>(`https://api.github.com/repos/${ownerRepo}`, { ttlMs: 12 * 3600_000 });
  return {
    repo: ownerRepo,
    stars: r.stargazers_count,
    forks: r.forks_count,
    openIssues: r.open_issues_count,
    createdAt: r.created_at,
    pushedAt: r.pushed_at,
    license: r.license?.spdx_id ?? null,
    archived: r.archived,
    isFork: r.fork,
    defaultBranch: r.default_branch,
    topics: r.topics ?? [],
    description: r.description,
  };
}
