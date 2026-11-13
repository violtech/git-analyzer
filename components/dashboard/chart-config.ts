import type { ChartConfig } from "@/components/ui/chart";
import type { AuthorKind } from "@/lib/agents";
import type { Granularity } from "@/lib/types";
import type { Range } from "@/lib/view";

export const GRANULARITIES: Granularity[] = ["week", "month", "quarter", "year"];
export const RANGES: Record<Range, string> = { "1": "1Y", "2": "2Y", "5": "5Y", all: "All" };
export const KINDS: Record<AuthorKind, string> = { all: "All", developers: "Developers", ai: "AI agents", bots: "Bots" };
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Shared x axis props for every period-based chart. */
export const xAxis = { dataKey: "key", tickLine: false, minTickGap: 32 } as const;

export const commitsCfg = { commits: { label: "Commits", color: "var(--chart-1)" } } satisfies ChartConfig;
export const locCfg = { loc: { label: "Codebase lines (est.)", color: "var(--chart-2)" } } satisfies ChartConfig;
export const churnCfg = {
  added: { label: "Added", color: "var(--chart-2)" },
  deleted: { label: "Deleted", color: "var(--chart-5)" },
} satisfies ChartConfig;
export const gapCfg = {
  avgGapHours: { label: "Mean gap (h)", color: "var(--chart-1)" },
  medianGapHours: { label: "Median gap (h)", color: "var(--chart-3)" },
} satisfies ChartConfig;
export const splitCfg = {
  humans: { label: "Human-only", color: "var(--chart-1)" },
  ai: { label: "AI-assisted", color: "var(--chart-4)" },
  bots: { label: "Bots", color: "var(--chart-3)" },
} satisfies ChartConfig;
export const velCfg = { rate: { label: "Commits / day (30-day rolling)", color: "var(--chart-1)" } } satisfies ChartConfig;
export const releaseCfg = { stableReleases: { label: "Stable releases", color: "var(--chart-2)" } } satisfies ChartConfig;
export const relGapCfg = { releaseGapDays: { label: "Days between stable releases", color: "var(--chart-3)" } } satisfies ChartConfig;
export const prCountCfg = {
  merged: { label: "Merged", color: "var(--chart-2)" },
  closed: { label: "Closed unmerged", color: "var(--chart-5)" },
} satisfies ChartConfig;
export const prLeadCfg = { leadDays: { label: "Median days to merge", color: "var(--chart-3)" } } satisfies ChartConfig;

export const intervalCommitsCfg = {
  human: { label: "Human-only", color: "var(--chart-1)" },
  agent: { label: "AI-assisted", color: "var(--chart-4)" },
} satisfies ChartConfig;
export const intervalPaceCfg = {
  days: { label: "Days since previous release", color: "var(--chart-3)" },
  commitsPerDay: { label: "Commits / day", color: "var(--chart-2)" },
} satisfies ChartConfig;
export const buildsCfg = { rollingBuilds: { label: "Tagged builds", color: "var(--chart-2)" } } satisfies ChartConfig;
