import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CACHE_ROOT } from "./home";

// One place for every GitHub REST call, so the app can't hammer the API:
//  - responses are cached on disk and served without a request while fresh
//  - stale entries are revalidated with ETags (a 304 does not use rate-limit budget)
//  - rate-limit headers are tracked, and calls stop before the budget is gone
//  - identical in-flight requests share one request
//  - if the limit is hit and an old copy exists, the old copy is served instead of an error

export type Resource = "core" | "search";

export interface Budget {
  limit: number;
  remaining: number;
  /** unix seconds when the window resets */
  reset: number;
}

export class RateLimitError extends Error {
  constructor(public resetAt: number, public resource: Resource) {
    super(
      `GitHub ${resource} rate limit reached. It resets at ${new Date(resetAt * 1000).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}.` +
        (process.env.GITHUB_TOKEN ? "" : " Setting GITHUB_TOKEN raises the limit."),
    );
  }
}

const CACHE = path.join(CACHE_ROOT, "http");
/** Never spend the last few requests: keep a reserve for the user's own actions. */
const RESERVE: Record<Resource, number> = { core: 5, search: 1 };
const budgets: Partial<Record<Resource, Budget>> = {};
const inflight = new Map<string, Promise<unknown>>();

interface Entry {
  etag: string | null;
  at: number;
  body: unknown;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "git-analytics", ...extra };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

function noteBudget(res: Response, fallback: Resource) {
  const resource = (res.headers.get("x-ratelimit-resource") === "search" ? "search" : res.headers.get("x-ratelimit-resource") ? "core" : fallback) as Resource;
  const limit = Number(res.headers.get("x-ratelimit-limit"));
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (limit && !Number.isNaN(remaining) && reset) budgets[resource] = { limit, remaining, reset };
}

async function readEntry(file: string): Promise<Entry | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Entry;
  } catch {
    return null;
  }
}

/** GET a GitHub API URL and parse the JSON, with caching and budget protection. */
export async function githubJson<T>(url: string, opts: { ttlMs: number; resource?: Resource }): Promise<T> {
  const resource = opts.resource ?? "core";
  const key = createHash("sha1").update(`${url}|${process.env.GITHUB_TOKEN ? "auth" : "anon"}`).digest("hex");
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const run = (async () => {
    const file = path.join(CACHE, `${key}.json`);
    const cached = await readEntry(file);
    if (cached && Date.now() - cached.at < opts.ttlMs) return cached.body as T;

    const b = budgets[resource];
    if (b && b.remaining <= RESERVE[resource] && Date.now() / 1000 < b.reset) {
      if (cached) return cached.body as T;
      throw new RateLimitError(b.reset, resource);
    }

    const res = await fetch(url, { headers: headers(cached?.etag ? { "If-None-Match": cached.etag } : {}) });
    noteBudget(res, resource);

    if (res.status === 304 && cached) {
      await fs.writeFile(file, JSON.stringify({ ...cached, at: Date.now() }));
      return cached.body as T;
    }
    if (res.status === 403 || res.status === 429) {
      const retry = Number(res.headers.get("retry-after"));
      const reset = retry ? Math.floor(Date.now() / 1000) + retry : Number(res.headers.get("x-ratelimit-reset")) || Math.floor(Date.now() / 1000) + 60;
      budgets[resource] = { limit: budgets[resource]?.limit ?? 0, remaining: 0, reset };
      if (cached) return cached.body as T;
      throw new RateLimitError(reset, resource);
    }
    if (!res.ok) throw new Error(`GitHub API error ${res.status}${res.status === 404 ? " (not found, or the repository is private)" : ""}`);

    const body = (await res.json()) as T;
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(file, JSON.stringify({ etag: res.headers.get("etag"), at: Date.now(), body } satisfies Entry));
    return body;
  })();

  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

export interface BudgetReport {
  authenticated: boolean;
  core: Budget | null;
  search: Budget | null;
}

let lastReport: { at: number; report: BudgetReport } | null = null;

/** Current limits. Asks GitHub's /rate_limit endpoint, which does not itself use any budget. */
export async function getBudget(force = false): Promise<BudgetReport> {
  const authenticated = !!process.env.GITHUB_TOKEN;
  if (!force && lastReport && Date.now() - lastReport.at < 30_000) return lastReport.report;
  try {
    const res = await fetch("https://api.github.com/rate_limit", { headers: headers() });
    if (res.ok) {
      const j = (await res.json()) as { resources: Record<string, { limit: number; remaining: number; reset: number }> };
      for (const r of ["core", "search"] as const) {
        const v = j.resources[r];
        if (v) budgets[r] = { limit: v.limit, remaining: v.remaining, reset: v.reset };
      }
    }
  } catch {
    // fall back to whatever we have seen from earlier responses
  }
  const report = { authenticated, core: budgets.core ?? null, search: budgets.search ?? null };
  lastReport = { at: Date.now(), report };
  return report;
}
