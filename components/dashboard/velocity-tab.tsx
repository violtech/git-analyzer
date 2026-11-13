import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { Granularity } from "@/lib/types";
import type { View } from "@/lib/view";
import { ChartCard } from "./chart-card";
import { DAYS, gapCfg, velCfg, xAxis } from "./chart-config";

function trend(change: number | null) {
  if (change === null) return { label: "No baseline", variant: "secondary" as const };
  if (change > 0.1) return { label: "Speeding up", variant: "default" as const };
  if (change < -0.1) return { label: "Slowing down", variant: "destructive" as const };
  return { label: "Steady", variant: "secondary" as const };
}

function Heatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="grid grid-cols-[2rem_repeat(24,minmax(0,1fr))] gap-0.5 text-[10px] text-muted-foreground">
      <span />
      {Array.from({ length: 24 }, (_, h) => (
        <span key={h} className="text-center">{h % 6 === 0 ? h : ""}</span>
      ))}
      {grid.map((row, d) => (
        <div key={d} className="contents">
          <span className="self-center">{DAYS[d]}</span>
          {row.map((n, h) => (
            <div
              key={h}
              title={`${DAYS[d]} ${h}:00 · ${n} commits`}
              className="aspect-square rounded-[2px] bg-chart-1"
              style={{ opacity: n ? 0.12 + 0.88 * (n / max) : 0.05 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function VelocityTab({ view, g }: { view: View; g: Granularity }) {
  const t = view.vel ? trend(view.vel.change) : null;
  return (
    <div className="space-y-4">
      {view.vel && t && (
        <ChartCard title="Velocity trend" description="Rolling 30-day commit rate, and the latest 30 days compared with the 30 days before.">
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <Badge variant={t.variant}>{t.label}</Badge>
            <span className="tabular-nums">
              {view.vel.current.toFixed(1)} commits/day now vs {view.vel.previous.toFixed(1)} before
              {view.vel.change !== null && ` (${view.vel.change > 0 ? "+" : ""}${Math.round(view.vel.change * 100)}%)`}
            </span>
          </div>
          <ChartContainer config={velCfg} className="h-56 w-full">
            <AreaChart data={view.vel.series}>
              <CartesianGrid vertical={false} />
              <XAxis {...xAxis} minTickGap={48} />
              <YAxis tickLine={false} axisLine={false} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area dataKey="rate" type="monotone" stroke="var(--color-rate)" fill="var(--color-rate)" fillOpacity={0.2} />
            </AreaChart>
          </ChartContainer>
        </ChartCard>
      )}

      <ChartCard
        title="Average time between commits"
        description={`How fast the project ships: hours between consecutive commits, per ${g}. Lower means a faster pace. Median ignores long idle gaps such as weekends.`}
      >
        <ChartContainer config={gapCfg} className="h-64 w-full">
          <LineChart data={view.buckets}>
            <CartesianGrid vertical={false} />
            <XAxis {...xAxis} />
            <YAxis tickLine={false} axisLine={false} width={48} unit="h" />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line dataKey="avgGapHours" type="monotone" stroke="var(--color-avgGapHours)" dot={false} strokeWidth={2} connectNulls />
            <Line dataKey="medianGapHours" type="monotone" stroke="var(--color-medianGapHours)" dot={false} strokeWidth={2} connectNulls />
          </LineChart>
        </ChartContainer>
      </ChartCard>

      <ChartCard title="When commits happen" description="Weekday by hour (UTC)">
        <Heatmap grid={view.grid} />
      </ChartCard>

      <ChartCard
        title="How changes are merged"
        description={view.mergeStyle.note}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead className="text-right">Commits</TableHead>
              <TableHead className="text-right">Squash-merged</TableHead>
              <TableHead className="text-right">Merge commits</TableHead>
              <TableHead className="text-right">Merge commits / 100</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="tabular-nums">
            {view.mergeStyle.years.map((y) => (
              <TableRow key={y.year}>
                <TableCell className="font-medium">{y.year}</TableCell>
                <TableCell className="text-right">{y.commits}</TableCell>
                <TableCell className="text-right">{y.squashPct}%</TableCell>
                <TableCell className="text-right">{y.mergeCommits}</TableCell>
                <TableCell className="text-right">{y.mergeCommitsPer100}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ChartCard>
    </div>
  );
}
