import { githubJson } from "./github-client";

export type ExplorePeriod = "week" | "month" | "year" | "all";
export type ExploreSort = "stars" | "updated";

export interface ExploreRepo {
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  topics: string[];
  createdAt: string;
  pushedAt: string;
}

export interface ExploreQuery {
  period: ExplorePeriod;
  topic: string;
  language: string;
  sort: ExploreSort;
  page: number;
}

export interface ExploreResult {
  items: ExploreRepo[];
  /** total matches GitHub reports (search results are capped at 1,000 reachable) */
  total: number;
}

const DAYS: Record<Exclude<ExplorePeriod, "all">, number> = { week: 7, month: 30, year: 365 };
const PAGE_SIZE = 12;
const SAFE = /^[\w.+#-]{0,40}$/;

interface ApiRepo {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics?: string[];
  created_at: string;
  pushed_at: string;
}

/**
 * GitHub has no official "trending" API. "all" = the most-starred repositories overall; the other periods = the
 * most-starred repositories created inside that window. Both can be narrowed by topic / language.
 */
export async function explore({ period, topic, language, sort, page }: ExploreQuery): Promise<ExploreResult> {
  if (!SAFE.test(topic) || !SAFE.test(language) || !(period === "all" || period in DAYS) || !(sort === "stars" || sort === "updated") || !Number.isInteger(page) || page < 1 || page > 20) {
    throw new Error("Invalid filter");
  }
  const parts: string[] = [];
  if (topic) parts.push(`topic:${topic}`);
  if (language) parts.push(`language:"${language}"`);
  if (period === "all") parts.push(topic || language ? "stars:>50" : "stars:>1000");
  else {
    const since = new Date(Date.now() - DAYS[period] * 86400000).toISOString().slice(0, 10);
    parts.push(`created:>${since}`);
  }

  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(parts.join(" "))}&sort=${sort}&order=desc&per_page=${PAGE_SIZE}&page=${page}`;
  // all-time rankings barely move, so they are cached longer than "new this week"
  const json = await githubJson<{ items: ApiRepo[]; total_count: number }>(url, {
    resource: "search",
    ttlMs: (period === "all" ? 12 : 1) * 3600_000,
  });
  const items = json.items.map<ExploreRepo>((r) => ({
    fullName: r.full_name,
    description: r.description,
    stars: r.stargazers_count,
    forks: r.forks_count,
    language: r.language,
    topics: (r.topics ?? []).slice(0, 4),
    createdAt: r.created_at,
    pushedAt: r.pushed_at,
  }));
  return { items, total: json.total_count };
}
