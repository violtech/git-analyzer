import { Info } from "lucide-react";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtHours, fmtNum } from "@/lib/aggregate";
import type { View } from "@/lib/view";

function Stat({ title, value, hint, info }: { title: string; value: string; hint?: string; info?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {title}
          {info && (
            <Tooltip>
              <TooltipTrigger className="text-muted-foreground hover:text-foreground" aria-label={`About ${title}`}>
                <Info className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-60">{info}</TooltipContent>
            </Tooltip>
          )}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && <CardFooter className="text-xs text-muted-foreground">{hint}</CardFooter>}
    </Card>
  );
}

export function StatCards({ view }: { view: View }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      <Stat title="Commits" value={fmtNum(view.commits)} hint="non-merge commits" />
      <Stat title="Contributors" value={fmtNum(view.contributorCount)} hint="distinct non-bot authors, by email" />
      <Stat
        title="AI-assisted"
        value={`${view.aiShare.toFixed(view.aiShare < 10 ? 1 : 0)}%`}
        hint={`${fmtNum(view.aiCommits)} commits · ${view.aiCategory}`}
        info="Commits authored or co-authored by a known AI agent, out of all non-bot, non-revert commits. Strict allowlist, so this is a lower bound."
      />
      <Stat
        title="Source code"
        value={`${fmtNum(view.loc)} lines`}
        hint={`+ tests ${fmtNum(view.locBreakdown.tests)} · docs ${fmtNum(view.locBreakdown.docs)}`}
        info={`Source-code lines in the tree at the latest commit (by file type), from monthly snapshots. Tests, docs, data and other files are counted separately: tests ${fmtNum(view.locBreakdown.tests)}, docs ${fmtNum(view.locBreakdown.docs)}, data ${fmtNum(view.locBreakdown.data)}, other ${fmtNum(view.locBreakdown.other)}. Lines changed in range: +${fmtNum(view.added)} / −${fmtNum(view.deleted)}.`}
      />
      <Stat
        title="Time between commits"
        value={fmtHours(view.meanGap)}
        hint="mean across periods"
        info="Average hours between consecutive commits. Lower means a faster pace."
      />
      <Stat
        title="Repo age"
        value={view.ageDays > 730 ? `${(view.ageDays / 365).toFixed(1)} yrs` : `${view.ageDays} days`}
        hint={`since ${view.firstDate.toISOString().slice(0, 10)}`}
      />
    </div>
  );
}
