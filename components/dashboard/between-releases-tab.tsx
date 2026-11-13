import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNum, median } from "@/lib/aggregate";
import type { View } from "@/lib/view";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard } from "./chart-card";
import { intervalCommitsCfg, intervalPaceCfg } from "./chart-config";

const short = (name: string) => name.replace(/^v/, "");
const days = (d: number) => (d < 1 ? `${Math.round(d * 24)} h` : `${d.toFixed(1)} d`);

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

export function BetweenReleasesTab({ view }: { view: View }) {
  const shipped = view.intervals.filter((r) => !r.unreleased);
  const open = view.intervals.find((r) => r.unreleased);
  if (!shipped.length) {
    return (
      <ChartCard title="Between releases">
        <p className="text-sm text-muted-foreground">Needs at least one stable release tag in the selected range.</p>
      </ChartCard>
    );
  }

  const medianDays = median(shipped.map((r) => r.days));
  const fastest = shipped.reduce((a, b) => (b.days < a.days ? b : a));
  const longest = shipped.reduce((a, b) => (b.days > a.days ? b : a));
  const avgCommits = shipped.reduce((s, r) => s + r.commits, 0) / shipped.length;

  const chartData = view.intervals.map((r) => ({
    label: r.unreleased ? "Unreleased" : short(r.name),
    human: r.commits - r.agentCommits,
    agent: r.agentCommits,
    days: Number(r.days.toFixed(2)),
    commitsPerDay: Number(r.commitsPerDay.toFixed(1)),
  }));
  const xAxis = { dataKey: "label", tickLine: false, minTickGap: 24 } as const;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini title="Median time between releases" value={days(medianDays ?? 0)} hint={`${shipped.length} stable releases`} />
        <Mini title="Fastest interval" value={days(fastest.days)} hint={short(fastest.name)} />
        <Mini title="Longest interval" value={days(longest.days)} hint={short(longest.name)} />
        <Mini title="Avg commits per release" value={fmtNum(Math.round(avgCommits))} hint={open ? `${open.commits} commits unreleased` : undefined} />
      </div>

      <ChartCard
        title="Commits in each release"
        description="Commits that landed between the previous stable release and this one, split by who wrote them. The last bar is work not yet released."
      >
        <ChartContainer config={intervalCommitsCfg} className="h-64 w-full">
          <BarChart data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis {...xAxis} />
            <YAxis tickLine={false} axisLine={false} width={40} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="human" stackId="c" fill="var(--color-human)" />
            <Bar dataKey="agent" stackId="c" fill="var(--color-agent)" />
          </BarChart>
        </ChartContainer>
      </ChartCard>

      <ChartCard
        title="Release pace"
        description="Days since the previous stable release, and how many commits per day went into each release. Shorter intervals with steady commits/day mean faster, smaller releases."
      >
        <ChartContainer config={intervalPaceCfg} className="h-64 w-full">
          <LineChart data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis {...xAxis} />
            <YAxis yAxisId="l" tickLine={false} axisLine={false} width={40} unit="d" />
            <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} width={40} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line yAxisId="l" dataKey="days" type="monotone" stroke="var(--color-days)" strokeWidth={2} dot />
            <Line yAxisId="r" dataKey="commitsPerDay" type="monotone" stroke="var(--color-commitsPerDay)" strokeWidth={2} dot />
          </LineChart>
        </ChartContainer>
      </ChartCard>

      <ChartCard
        title="Release by release"
        description="Commits are assigned by commit time between two stable release tags, which approximates git log previous..release."
      >
        <div className="max-h-96 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Release</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Interval</TableHead>
                <TableHead className="text-right">Commits</TableHead>
                <TableHead className="text-right">/ day</TableHead>
                <TableHead className="text-right">People</TableHead>
                <TableHead className="text-right">+ lines</TableHead>
                <TableHead className="text-right">− lines</TableHead>
                <TableHead className="text-right">Agent</TableHead>
                <TableHead className="text-right">Pre-builds</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {[...view.intervals].reverse().map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-medium">
                    {r.unreleased ? <Badge variant="secondary">Unreleased</Badge> : short(r.name)}
                  </TableCell>
                  <TableCell>{new Date(r.end * 1000).toISOString().slice(0, 10)}</TableCell>
                  <TableCell className="text-right">{days(r.days)}</TableCell>
                  <TableCell className="text-right">{r.commits}</TableCell>
                  <TableCell className="text-right">{r.commitsPerDay.toFixed(1)}</TableCell>
                  <TableCell className="text-right">{r.contributors}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.added)}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.deleted)}</TableCell>
                  <TableCell className="text-right">{r.commits ? Math.round((r.agentCommits / r.commits) * 100) : 0}%</TableCell>
                  <TableCell className="text-right">{r.preBuilds}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ChartCard>
    </div>
  );
}
