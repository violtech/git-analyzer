export interface CommitRow {
  /** unix seconds */
  t: number;
  /** index into Analysis.authors */
  a: number;
  /** lines added / deleted, after ignoring generated, vendored and data files */
  add: number;
  del: number;
  /** indexes into Analysis.agents: AI agents that authored or co-authored this commit */
  ag: number[];
  /** authored by an automation bot (dependabot, github-actions, ...) */
  bot?: 1;
  /** bulk commit: more than Analysis.bulkLines counted lines in one commit */
  b?: 1;
  /** housekeeping commit (revert, version bump): left out of the AI-share denominator */
  x?: 1;
  /** squash-merged through a pull request: the subject ends in (#123) */
  sq?: 1;
}

export interface BulkCommit {
  /** short hash */
  h: string;
  t: number;
  a: number;
  lines: number;
  /** commit subject, truncated */
  s: string;
}

export interface ReleaseRow {
  name: string;
  /** unix seconds */
  t: number;
  /** pre-release / channel build (canary, nightly, beta, rc ...) */
  pre: boolean;
  /** main-line stable release (v1.2.3, 2026.1005.0). Package tags like @scope/pkg@1.2.3 are not kept. */
  stable: boolean;
  /** continuous build number (llama.cpp b1234): a build, not a release */
  rolling: boolean;
}

export interface Analysis {
  repo: string;
  source: string;
  branch: string;
  fetchedAt: number;
  /** rules + overrides the analysis was classified with; a mismatch triggers a re-read of the local clone */
  classifier: string;
  /** hash of the release rules the tags were classified with */
  releaseRulesId: string;
  /** hash of the repository's vendored path patterns; empty when it has none */
  vendoredId?: string;
  /** the per-repository rules this analysis used (release tag rules, vendored paths, repository-only agent names) */
  appliedRules?: { release: import("./tags").ReleaseRules | null; vendored: string[]; agents: { ai?: string[]; bot?: string[]; human?: string[] } | null };
  /** commits with more counted lines than this are flagged as large ("bulk") */
  bulkLines: number;
  /** measured size from the tree at the end of each month, plus HEAD. `loc` is source code only; tests, docs, data and other are reported beside it. */
  snapshots: { t: number; loc: number; tests: number; docs: number; data: number; other: number }[];
  authors: string[];
  /** indexes into authors that are automation bots */
  botAuthors: number[];
  /** indexes into authors that are AI agents (the author itself is an AI identity) */
  aiAuthors: number[];
  /** AI agent labels (Claude, Copilot, ...) */
  agents: string[];
  commits: CommitRow[];
  releases: ReleaseRow[];
  /** how the project versions what it ships */
  releaseStyle: "semver" | "calendar" | "rolling-builds" | "none";
  /** monorepo package tags ignored when counting releases */
  packageTags: number;
  /** commit analysed (full sha of the ref read: HEAD, or the --pin commit) */
  headSha?: string;
  /** set when the analysis was pinned to a commit with --pin */
  pinned?: boolean;
  /** creation times of tags that are not releases of the project, by why: package tags, ignored by rule, not a version, same version tagged twice */
  otherTags?: { package: number[]; ignored: number[]; other: number[]; duplicate: number[] };
  /** timestamps of merge commits (which the commit stats leave out) */
  mergeTimes: number[];
  /** AI-agent instruction files in the current tree, earliest first */
  agentFiles: { tool: string; path: string; files: number; addedAt: number | null }[];
  /** largest bulk commits, biggest first */
  bulk: BulkCommit[];
  /** co-author names that matched no rule (review for AI tools missing from the allowlist) */
  unrecognized: { name: string; count: number }[];
}

export type Granularity = "week" | "month" | "quarter" | "year";

export interface Bucket {
  key: string;
  start: number;
  commits: number;
  added: number;
  deleted: number;
  net: number;
  /** estimated codebase size (cumulative added - deleted) at end of bucket */
  loc: number;
  /** tree size by category at the end of the period (loc is the source part) */
  locBreakdown: { source: number; tests: number; docs: number; data: number; other: number };
  contributors: number;
  /** mean hours between consecutive commits inside the bucket (null if < 2 commits) */
  avgGapHours: number | null;
  medianGapHours: number | null;
  commitsPerDay: number;
  /** commits authored or co-authored by an AI agent */
  aiCommits: number;
  /** commits authored by automation bots */
  botCommits: number;
  stableReleases: number;
  preReleases: number;
  /** continuous builds (b1234) tagged in this period */
  rollingBuilds: number;
  /** mean days between consecutive stable releases ending in this bucket */
  releaseGapDays: number | null;
}

export interface PullStats {
  repo: string;
  fetchedAt: number;
  sampled: number;
  total: number | null;
  truncated: boolean;
  authenticated: boolean;
  /** months of history that were requested; null = everything the rate limit allowed */
  windowMonths: number | null;
  prs: { created: number; closed: number; merged: boolean }[];
}

export type ProgressStage = "cache" | "clone" | "fetch" | "commits" | "snapshots" | "tags";

export interface ProgressEvent {
  stage: ProgressStage;
  /** 0-100 inside the stage, or null when unknown */
  pct: number | null;
  message: string;
}

/** One line of the NDJSON stream returned by /api/analyze/stream */
export type StreamMessage =
  | ({ type: "progress" } & ProgressEvent)
  | { type: "done"; data: Analysis }
  | { type: "error"; error: string };
