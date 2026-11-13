import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { fmtNum } from "@/lib/aggregate";
import type { View } from "@/lib/view";
import { ChartCard } from "./chart-card";
import { buildsCfg, relGapCfg, releaseCfg, xAxis } from "./chart-config";

const STYLE_LABEL: Record<View["stability"]["versionStyle"], string> = {
  patch: "Patch-style versions (x.y.Z)",
  "minor-bump": "Minor-bump versions (x.Y.0)",
  calendar: "Calendar versions",
  "rolling-builds": "Rolling builds",
  none: "No releases found",
};

function Mini({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-xl tabular-nums">{value}</CardTitle>
        {hint && <CardDescription className="text-xs">{hint}</CardDescription>}
      </CardHeader>
    </Card>
  );
}

const dash = (v: number | null | undefined, unit = "") => (v === null || v === undefined ? "–" : `${v}${unit}`);

function Stability({ s }: { s: View["stability"] }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{STYLE_LABEL[s.versionStyle]}</Badge>
        <span className="text-muted-foreground">last 12 months to {s.asOf}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini title="Releases" value={dash(s.releases.last12Months)} hint={`${s.releases.previous12Months} the year before`} />
        <Mini title="Median days between" value={dash(s.medianDaysBetween, " d")} />
        <Mini
          title="Commits per release"
          value={dash(s.commitsPerRelease.median)}
          hint={`max ${dash(s.commitsPerRelease.max)} · ${s.commitsPerRelease.releasesOver50Commits} over 50 · with bots: median ${dash(s.commitsPerRelease.includingBots.median)}`}
        />
        <Mini
          title="Feature releases fixed in 7 days"
          value={s.fixedWithin7Days.applicable ? `${s.fixedWithin7Days.fixed} of ${s.fixedWithin7Days.featureReleases}` : "n/a"}
          hint={s.fixedWithin7Days.applicable ? undefined : "only for patch-style versions"}
        />
        <Mini title="New major versions" value={dash(s.newMajors.length)} hint={s.newMajors.slice(0, 3).join(", ") || undefined} />
        <Mini title="Patch releases" value={dash(s.patchReleasePct, "%")} />
        <Mini title="Since latest release" value={dash(s.daysSinceLatestRelease, " d")} hint={s.latestStable ?? undefined} />
        <Mini
          title="Unreleased commits"
          value={dash(s.unreleasedCommits)}
          hint={`AI-assisted share ${dash(s.aiSharePct.last12Months, "%")} (was ${dash(s.aiSharePct.previous12Months, "%")})`}
        />
      </div>
    </div>
  );
}

export function ReleasesTab({ view }: { view: View }) {
  const rolling = view.releaseStyle === "rolling-builds";
  const note = view.packageTags ? ` ${fmtNum(view.packageTags)} monorepo package tags (like @scope/pkg@1.2.3) are not counted.` : "";

  return (
    <div className="space-y-4">
      <ChartCard
        title="Release stability"
        description="How a project ships: cadence, release size and how often a release needs a quick fix. Commits counted exclude bots, reverts and version bumps."
      >
        <Stability s={view.stability} />
      </ChartCard>

      {rolling && (
        <Alert>
          <AlertDescription>
            This project ships continuous builds ({fmtNum(view.rolling)} tagged in range, like b1234) rather than numbered releases.
            Build cadence is shown instead of release cadence; the {view.stable.length} numbered releases in range are not representative.
          </AlertDescription>
        </Alert>
      )}

      {rolling ? (
        <ChartCard title="Build cadence" description={`Tagged builds per ${view.buckets.length ? "period" : "period"}.${note}`}>
          <ChartContainer config={buildsCfg} className="h-64 w-full">
            <BarChart data={view.buckets}>
              <CartesianGrid vertical={false} />
              <XAxis {...xAxis} />
              <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="rollingBuilds" fill="var(--color-rollingBuilds)" radius={2} />
            </BarChart>
          </ChartContainer>
        </ChartCard>
      ) : (
        <ChartCard
          title="Release cadence"
          description={`Stable releases from git tags: ${view.stable.length} in range, plus ${fmtNum(view.pre)} pre-release builds (canary, beta, rc, nightly). The same version tagged twice counts once.${note} Days between stable releases shows how often the project ships.`}
        >
          {view.stable.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartContainer config={releaseCfg} className="h-64 w-full">
                <BarChart data={view.buckets}>
                  <CartesianGrid vertical={false} />
                  <XAxis {...xAxis} />
                  <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="stableReleases" fill="var(--color-stableReleases)" radius={2} />
                </BarChart>
              </ChartContainer>
              <ChartContainer config={relGapCfg} className="h-64 w-full">
                <LineChart data={view.buckets}>
                  <CartesianGrid vertical={false} />
                  <XAxis {...xAxis} />
                  <YAxis tickLine={false} axisLine={false} width={40} unit="d" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line dataKey="releaseGapDays" type="monotone" stroke="var(--color-releaseGapDays)" strokeWidth={2} dot connectNulls />
                </LineChart>
              </ChartContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No stable release tags found in this range.</p>
          )}
        </ChartCard>
      )}
    </div>
  );
}
