"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BudgetReport } from "@/lib/github-client";

const time = (reset: number) => new Date(reset * 1000).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });

/** Small footer indicator of the remaining GitHub API budget (the check itself costs nothing). */
export function ApiBudget() {
  const [b, setB] = useState<BudgetReport | null>(null);

  useEffect(() => {
    fetch("/api/github-budget")
      .then((r) => r.json())
      .then(setB)
      .catch(() => {});
  }, []);

  if (!b?.core) return null;
  const low = b.core.remaining <= 10 || (b.search?.remaining ?? 99) <= 2;
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant={low ? "destructive" : "outline"} className="font-normal tabular-nums" />}>
        GitHub API {b.core.remaining}/{b.core.limit}
        {b.search ? ` · search ${b.search.remaining}/${b.search.limit}` : ""}
        {b.authenticated ? "" : " · no token"}
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        Requests left this hour (core) and this minute (search). Core resets at {time(b.core.reset)}.
        {b.authenticated ? "" : " Set GITHUB_TOKEN to raise the limits."} Cloning and reading history do not use the API.
      </TooltipContent>
    </Tooltip>
  );
}
