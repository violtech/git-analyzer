import { ExternalLink, GitFork, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtNum } from "@/lib/aggregate";
import type { ExploreRepo } from "@/lib/explore";

function ago(iso: string) {
  const d = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86400000));
  if (d < 1) return "today";
  if (d < 31) return `${d}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${(d / 365).toFixed(1)}y ago`;
}

interface Props {
  repo: ExploreRepo;
  activeTopic: string;
  onAnalyze: (fullName: string) => void;
  onTopic: (topic: string) => void;
}

export function RepoCard({ repo, activeTopic, onAnalyze, onTopic }: Props) {
  const [owner, name] = repo.fullName.split("/");
  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <CardTitle className="truncate" title={repo.fullName}>
          <span className="font-normal text-muted-foreground">{owner}/</span>
          {name}
        </CardTitle>
        <CardAction>
          <Tooltip>
            <TooltipTrigger render={<Badge variant="secondary" className="gap-1 tabular-nums" />}>
              <Star className="size-3" />
              {fmtNum(repo.stars)}
            </TooltipTrigger>
            <TooltipContent>{repo.stars.toLocaleString("en")} stars · {repo.forks.toLocaleString("en")} forks</TooltipContent>
          </Tooltip>
        </CardAction>
        <CardDescription className="line-clamp-2 min-h-10">{repo.description ?? "No description"}</CardDescription>
      </CardHeader>

      <CardContent className="mt-auto space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {repo.language && <span>{repo.language}</span>}
          <span className="flex items-center gap-1"><GitFork className="size-3" />{fmtNum(repo.forks)}</span>
          <span>updated {ago(repo.pushedAt)}</span>
        </div>
        <div className="flex min-h-5 flex-wrap gap-1">
          {repo.topics.map((t) => (
            <button key={t} type="button" onClick={() => onTopic(t)} aria-label={`Filter by topic ${t}`} className="rounded-full">
              <Badge variant={t === activeTopic ? "default" : "outline"} className="cursor-pointer font-normal">{t}</Badge>
            </button>
          ))}
        </div>
      </CardContent>

      <CardFooter className="gap-2">
        <Button size="sm" className="flex-1" onClick={() => onAnalyze(repo.fullName)}>Analyze</Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <a
                href={`https://github.com/${repo.fullName}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${repo.fullName} on GitHub`}
                className={buttonVariants({ variant: "outline", size: "icon-sm" })}
              />
            }
          >
            <ExternalLink />
          </TooltipTrigger>
          <TooltipContent>Open on GitHub</TooltipContent>
        </Tooltip>
      </CardFooter>
    </Card>
  );
}
