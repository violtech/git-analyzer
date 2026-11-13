"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ProgressEvent, ProgressStage } from "@/lib/types";

const STEPS: { id: string; label: string; stages: ProgressStage[] }[] = [
  { id: "fetch", label: "Download repository", stages: ["clone", "fetch", "cache"] },
  { id: "commits", label: "Read commit history", stages: ["commits"] },
  { id: "snapshots", label: "Measure code size", stages: ["snapshots"] },
  { id: "tags", label: "Read release tags", stages: ["tags"] },
];

/** Overall 0-100 from the active stage and its own percentage. */
function overall(p: ProgressEvent | null): number {
  if (!p) return 2;
  const inner = p.pct ?? 0;
  switch (p.stage) {
    case "clone": return 2 + inner * 0.4;
    case "fetch": return 5 + inner * 0.35;
    case "cache": return 95;
    case "commits": return 38 + inner * 0.32;
    case "snapshots": return 70 + inner * 0.24;
    case "tags": return 94;
  }
}

function useElapsed(running: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    const id = setInterval(() => setS(Math.floor((Date.now() - start) / 1000)), 500);
    return () => {
      clearInterval(id);
      setS(0);
    };
  }, [running]);
  return s;
}

export function ProgressCard({ repo, progress }: { repo: string; progress: ProgressEvent | null }) {
  const elapsed = useElapsed(true);
  const activeIdx = progress ? STEPS.findIndex((s) => s.stages.includes(progress.stage)) : 0;
  const pct = Math.round(overall(progress));

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <CardTitle>Analyzing {repo}</CardTitle>
        <CardDescription aria-live="polite">{progress?.message ?? "Starting"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Progress value={pct} aria-label="Analysis progress" />
          <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
            <span>{pct}%</span>
            <span>{elapsed}s</span>
          </div>
        </div>
        <ol className="space-y-2 text-sm">
          {STEPS.map((s, i) => {
            const done = i < activeIdx;
            const active = i === activeIdx;
            return (
              <li key={s.id} className={`flex items-center gap-2 ${done || active ? "" : "text-muted-foreground"}`}>
                {done ? (
                  <Check className="size-4 text-chart-2" />
                ) : active ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <span className="size-4 rounded-full border" />
                )}
                {s.label}
              </li>
            );
          })}
        </ol>
        <p className="text-xs text-muted-foreground">
          The first run on a large repository downloads its full history, so it can take a minute. Repeat runs are cached.
        </p>
      </CardContent>
    </Card>
  );
}
