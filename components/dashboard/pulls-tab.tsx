import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { fmtHours, fmtNum } from "@/lib/aggregate";
import type { PullStats } from "@/lib/types";
import type { View } from "@/lib/view";
import { ChartCard } from "./chart-card";
import { prCountCfg, prLeadCfg, xAxis } from "./chart-config";

interface Props {
  view: View;
  githubRepo: string | null;
  pulls: PullStats | null;
  loading: boolean;
  error: string | null;
  onLoad: (full: boolean) => void;
}

export function PullsTab({ view, githubRepo, pulls, loading, error, onLoad }: Props) {
  return (
    <ChartCard
      title="Pull request lead time"
      description="Time from a pull request being opened to merged, and merged vs closed without merging. Uses the GitHub API, so by default only the last 12 months are loaded to save API budget. Pages are cached on disk."
    >
      {!githubRepo ? (
        <p className="text-sm text-muted-foreground">Pull request data is only available for GitHub repositories.</p>
      ) : !pulls ? (
        <div className="space-y-3">
          <Button variant="outline" disabled={loading} onClick={() => onLoad(false)}>
            {loading ? "Loading pull requests…" : "Load pull request stats"}
          </Button>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm tabular-nums">
            Median time to merge <b>{view.prMedianDays === null ? "–" : fmtHours(view.prMedianDays * 24)}</b> ·{" "}
            {pulls.prs.filter((p) => p.merged).length} merged / {pulls.prs.filter((p) => !p.merged).length} closed unmerged
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              {pulls.windowMonths === null ? "Full history" : `Last ${pulls.windowMonths} months`} · {fmtNum(pulls.sampled)} closed PRs
            </span>
            {pulls.windowMonths !== null && (
              <Button variant="outline" size="xs" disabled={loading} onClick={() => onLoad(true)}>
                {loading ? "Loading…" : "Load full history"}
              </Button>
            )}
          </div>
          {pulls.truncated && (
            <Alert>
              <AlertDescription>
                Stopped early to protect the GitHub API limit, so older pull requests are missing
                {pulls.authenticated ? "." : ". Set GITHUB_TOKEN to load more."}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartContainer config={prLeadCfg} className="h-64 w-full">
              <LineChart data={view.pr?.map((b) => ({ ...b, leadDays: b.medianLeadHours === null ? null : b.medianLeadHours / 24 }))}>
                <CartesianGrid vertical={false} />
                <XAxis {...xAxis} />
                <YAxis tickLine={false} axisLine={false} width={40} unit="d" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line dataKey="leadDays" type="monotone" stroke="var(--color-leadDays)" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ChartContainer>
            <ChartContainer config={prCountCfg} className="h-64 w-full">
              <BarChart data={view.pr ?? []}>
                <CartesianGrid vertical={false} />
                <XAxis {...xAxis} />
                <YAxis tickLine={false} axisLine={false} width={40} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="merged" stackId="p" fill="var(--color-merged)" />
                <Bar dataKey="closed" stackId="p" fill="var(--color-closed)" />
              </BarChart>
            </ChartContainer>
          </div>
        </div>
      )}
    </ChartCard>
  );
}
