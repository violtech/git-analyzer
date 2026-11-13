import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { fmtNum } from "@/lib/aggregate";
import type { Analysis, Granularity } from "@/lib/types";
import type { View } from "@/lib/view";
import { ChartCard } from "./chart-card";
import { churnCfg, commitsCfg, locCfg, xAxis } from "./chart-config";
import { PulseCard } from "./pulse-card";

interface Props {
  view: View;
  data: Analysis;
  g: Granularity;
  excludeBulk: boolean;
  onExcludeBulk: (v: boolean) => void;
}

function BulkNotice({ view, data, excludeBulk, onExcludeBulk }: Omit<Props, "g">) {
  const { bulk } = view;
  if (!bulk.count) return null;
  const who = (a: number) => data.authors[a] ?? "unknown";
  return (
    <Alert className="mb-4">
      <AlertTitle>
        {bulk.count} large commit{bulk.count === 1 ? "" : "s"} (over {fmtNum(bulk.threshold)} lines)
        {bulk.netSharePct !== null && ` account for ${Math.round(bulk.netSharePct)}% of net lines added in this range`}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Codebase size is measured from tree snapshots, so these do not distort it. They can still dominate the added and deleted charts: many are real squash-merged features, others are imports or generated files. Check the list below before deciding.
        </p>
        <label className="flex items-center gap-2 text-foreground">
          <Switch checked={excludeBulk} onCheckedChange={onExcludeBulk} aria-label="Leave large commits out of line stats" />
          Leave large commits out of added/deleted charts and line stats
        </label>
        <ul className="space-y-0.5 text-xs tabular-nums">
          {bulk.top.map((b) => (
            <li key={b.h}>
              <code>{b.h}</code> · {new Date(b.t * 1000).toISOString().slice(0, 10)} · {fmtNum(b.lines)} lines · {who(b.a)} · {b.s}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

export function OverviewTab({ view, data, g, excludeBulk, onExcludeBulk }: Props) {
  return (
    <div className="space-y-4">
      <PulseCard pulse={view.pulse} />

      <ChartCard title="Commit timeline" description={`Commits per ${g}`}>
        <ChartContainer config={commitsCfg} className="h-64 w-full">
          <BarChart data={view.buckets}>
            <CartesianGrid vertical={false} />
            <XAxis {...xAxis} />
            <YAxis tickLine={false} axisLine={false} width={40} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="commits" fill="var(--color-commits)" radius={2} />
          </BarChart>
        </ChartContainer>
      </ChartCard>

      <BulkNotice view={view} data={data} excludeBulk={excludeBulk} onExcludeBulk={onExcludeBulk} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Source code growth"
          description={`Source-code lines in the tree at the end of each month, by file type (shorter periods show the latest month). Counted separately: tests ${fmtNum(view.locBreakdown.tests)}, docs ${fmtNum(view.locBreakdown.docs)}, data ${fmtNum(view.locBreakdown.data)}, other ${fmtNum(view.locBreakdown.other)} lines.`}
        >
          <ChartContainer config={locCfg} className="h-64 w-full">
            <AreaChart data={view.buckets}>
              <CartesianGrid vertical={false} />
              <XAxis {...xAxis} />
              <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={fmtNum} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area dataKey="loc" type="monotone" stroke="var(--color-loc)" fill="var(--color-loc)" fillOpacity={0.25} />
            </AreaChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard title="Lines added vs deleted" description={`Churn per ${g}`}>
          <ChartContainer config={churnCfg} className="h-64 w-full">
            <BarChart data={view.churn} stackOffset="sign">
              <CartesianGrid vertical={false} />
              <XAxis {...xAxis} />
              <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={fmtNum} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="added" stackId="a" fill="var(--color-added)" />
              <Bar dataKey="deleted" stackId="a" fill="var(--color-deleted)" />
            </BarChart>
          </ChartContainer>
        </ChartCard>
      </div>
    </div>
  );
}
