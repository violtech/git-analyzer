import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { View } from "@/lib/view";

type Status = { label: string; variant: "default" | "secondary" | "destructive" | "outline" };

/** Wording is about activity, not abandonment: finished software can be quiet and still fine. */
function status(days: number | null): Status {
  if (days === null) return { label: "No commits", variant: "outline" };
  if (days <= 30) return { label: "Active", variant: "default" };
  if (days <= 90) return { label: "Slowing", variant: "secondary" };
  if (days <= 180) return { label: "Quiet 3+ months", variant: "secondary" };
  if (days <= 365) return { label: "Quiet 6+ months", variant: "destructive" };
  return { label: "No activity for a year+", variant: "destructive" };
}

const age = (d: number | null) => (d === null ? "none" : d < 1 ? "today" : d < 60 ? `${Math.round(d)} days ago` : `${(d / 30.4).toFixed(1)} months ago`);

export function PulseCard({ pulse }: { pulse: View["pulse"] }) {
  const s = status(pulse.daysSinceCommit);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Pulse <Badge variant={s.variant}>{s.label}</Badge>
        </CardTitle>
        <CardDescription>
          Based on commits by people and AI agents. Bot commits (dependabot and similar) are ignored, so automation can&apos;t make a quiet project look alive.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm tabular-nums sm:grid-cols-5">
        <div><div className="text-xs text-muted-foreground">Last commit</div>{age(pulse.daysSinceCommit)}</div>
        <div><div className="text-xs text-muted-foreground">Last stable release</div>{age(pulse.daysSinceRelease)}</div>
        <div><div className="text-xs text-muted-foreground">Commits, 90 days</div>{pulse.last90}</div>
        <div><div className="text-xs text-muted-foreground">Commits, 180 days</div>{pulse.last180}</div>
        <div><div className="text-xs text-muted-foreground">Commits, 12 months</div>{pulse.last365}</div>
      </CardContent>
    </Card>
  );
}
