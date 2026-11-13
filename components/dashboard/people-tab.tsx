import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtNum } from "@/lib/aggregate";
import type { AuthorKind } from "@/lib/agents";
import type { Granularity } from "@/lib/types";
import type { View } from "@/lib/view";
import { ChartCard } from "./chart-card";
import { KINDS, splitCfg, xAxis } from "./chart-config";

interface Props {
  view: View;
  g: Granularity;
  kind: AuthorKind;
  onKind: (k: AuthorKind) => void;
}

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

const pct = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)}%`;

export function PeopleTab({ view, g, kind, onKind }: Props) {
  const { adoption, medianAdd, busFactor } = view;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Mini title="AI-assisted share" value={pct(view.aiShare)} hint={`${view.aiCategory} adoption · lower bound`} />
        <Mini
          title="Since first AI commit"
          value={adoption ? pct(adoption.share) : "–"}
          hint={adoption ? `${adoption.date.toISOString().slice(0, 10)}${adoption.reliable ? "" : " · fewer than 10 commits"}` : "no AI commits found"}
        />
        <Mini
          title="Median lines added / commit"
          value={`${medianAdd.ai ?? "–"} AI · ${medianAdd.human ?? "–"} human`}
          hint="after ignoring generated files"
        />
        <Mini
          title="Bus factor (12 months)"
          value={busFactor ? `${busFactor.n} of ${busFactor.people}` : "–"}
          hint="people behind half of commits"
        />
        <Mini
          title="Agent instruction files"
          value={view.agentFiles.length ? `${view.agentFiles.length} tool${view.agentFiles.length === 1 ? "" : "s"}` : "none"}
          hint={view.agentFiles.length ? `${view.agentFiles.map((f) => f.tool).slice(0, 3).join(", ")}${view.agentFiles[0].addedAt ? ` · since ${new Date(view.agentFiles[0].addedAt * 1000).toISOString().slice(0, 7)}` : ""}` : "no AGENTS.md, CLAUDE.md, .cursor/rules ..."}
        />
      </div>

      <ChartCard
        title="AI-assisted vs human commits"
        description={`Commits per ${g}. AI-assisted means authored or co-authored by a known AI agent. Bots such as dependabot are shown separately and left out of the share.`}
      >
        <ChartContainer config={splitCfg} className="h-64 w-full">
          <BarChart data={view.split}>
            <CartesianGrid vertical={false} />
            <XAxis {...xAxis} />
            <YAxis tickLine={false} axisLine={false} width={40} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="humans" stackId="s" fill="var(--color-humans)" />
            <Bar dataKey="ai" stackId="s" fill="var(--color-ai)" />
            <Bar dataKey="bots" stackId="s" fill="var(--color-bots)" />
          </BarChart>
        </ChartContainer>
      </ChartCard>

      <ChartCard
        title="Top contributors"
        description="In the selected range. Contributors are merged by email address. AI agents are known AI identities and Co-Authored-By trailers; bots are automation accounts."
      >
        <ToggleGroup variant="outline" size="sm" className="mb-3" value={[kind]} onValueChange={(v) => v[0] && onKind(v[0] as AuthorKind)}>
          {(Object.keys(KINDS) as AuthorKind[]).map((k) => (
            <ToggleGroupItem key={k} value={k}>{KINDS[k]}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Author</TableHead>
              <TableHead className="text-right">Commits</TableHead>
              <TableHead className="text-right">+ lines</TableHead>
              <TableHead className="text-right">− lines</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="tabular-nums">
            {view.table.slice(0, 15).map((p) => (
              <TableRow key={p.name}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-right">{p.commits}</TableCell>
                <TableCell className="text-right">{fmtNum(p.add)}</TableCell>
                <TableCell className="text-right">{fmtNum(p.del)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ChartCard>

      <ChartCard
        title="Detection details"
        description="Check these before quoting an AI share: which identities were counted each year, and which co-author names matched no rule."
      >
        <div className="space-y-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">Commits</TableHead>
                <TableHead className="text-right">AI-assisted</TableHead>
                <TableHead className="text-right">Share</TableHead>
                <TableHead>Identities (commits)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {view.detection.years.map((y) => (
                <TableRow key={y.year}>
                  <TableCell className="font-medium">{y.year}</TableCell>
                  <TableCell className="text-right">{y.base}</TableCell>
                  <TableCell className="text-right">{y.ai}</TableCell>
                  <TableCell className="text-right">{pct(y.share)}</TableCell>
                  <TableCell className="whitespace-normal">
                    {y.agents.length ? y.agents.slice(0, 6).map(([n, c]) => `${n} ${c}`).join(" · ") : "–"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="space-y-2">
            <p className="text-sm font-medium">Co-author names that matched no rule</p>
            {view.detection.unrecognized.length ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {view.detection.unrecognized.slice(0, 20).map((u) => (
                    <Badge key={u.name} variant="outline" className="font-normal">{u.name} · {u.count}</Badge>
                  ))}
                </div>
                <Alert>
                  <AlertDescription>
                    If any of these are AI tools, add them to <code>agents.config.json</code> under <code>ai</code> (exact names) and analyze the repository again. This re-reads the local clone, with no network use. Most are probably people.
                  </AlertDescription>
                </Alert>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">None. Every co-author was either classified or there are no Co-Authored-By trailers.</p>
            )}
          </div>
        </div>
      </ChartCard>
    </div>
  );
}
