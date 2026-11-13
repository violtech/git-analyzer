import { Activity, Bot, Gauge, GitBranch, GitPullRequest, Tag, TrendingUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProgressEvent } from "@/lib/types";
import { ApiBudget } from "./api-budget";
import { Explorer } from "./explorer/explorer";
import { ProgressCard } from "./progress-card";

const EXAMPLES = ["paperclipai/paperclip", "honojs/hono", "colinhacks/zod"];

const FEATURES = [
  { icon: Activity, title: "Commit timeline", text: "Commits per week, month, quarter or year, with a 1Y to All range." },
  { icon: TrendingUp, title: "Codebase growth", text: "Estimated lines of code over time, plus lines added and deleted." },
  { icon: Gauge, title: "Velocity trend", text: "A rolling 30-day commit rate that tells you if the project is speeding up or slowing down." },
  { icon: Tag, title: "Release cadence", text: "Days between stable releases and what landed in each one." },
  { icon: GitPullRequest, title: "Pull request lead time", text: "How long pull requests take to merge, and how many are closed unmerged." },
  { icon: Bot, title: "Agents vs developers", text: "Which commits were written or co-authored by bots and AI agents." },
];

interface Props {
  input: string;
  onInput: (v: string) => void;
  onAnalyze: (repo?: string) => void;
  loading: boolean;
  progress: ProgressEvent | null;
  error: string | null;
}

export function Landing({ input, onInput, onAnalyze, loading, progress, error }: Props) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="mx-auto flex max-w-5xl items-center gap-2 p-4 md:px-8">
        <GitBranch className="size-5" />
        <span className="text-lg font-semibold tracking-tight">Git Analytics</span>
      </header>

      <main className="mx-auto max-w-5xl space-y-12 px-4 pb-16 pt-10 md:px-8 md:pt-16">
        <section className="mx-auto max-w-2xl space-y-6 text-center">
          <Badge variant="secondary">Runs locally · public GitHub repos or local folders</Badge>
          <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            See how fast a codebase really moves
          </h1>
          <p className="text-balance text-muted-foreground">
            Paste a repository to get its commit timeline, code growth, release cadence and pull request lead time, and to see how much of it was written with AI agents.
          </p>

          {loading ? (
            <ProgressCard repo={input.replace(/^https?:\/\/github\.com\//, "")} progress={progress} />
          ) : (
            <div className="space-y-4">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  onAnalyze();
                }}
              >
                <Input
                  autoFocus
                  value={input}
                  onChange={(e) => onInput(e.target.value)}
                  placeholder="github.com/owner/repo, owner/repo or C:\path\to\repo"
                  aria-label="Repository"
                  className="h-10 text-base"
                />
                <Button type="submit" size="lg" className="h-10 px-6">Analyze</Button>
              </form>
              <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
                <span>Try:</span>
                {EXAMPLES.map((r) => (
                  <Button key={r} type="button" variant="outline" size="sm" onClick={() => onAnalyze(r)}>
                    {r}
                  </Button>
                ))}
              </div>
              {error && (
                <Alert variant="destructive" className="text-left">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </section>

        {!loading && (
          <Tabs defaultValue="explore" className="space-y-6">
            <div className="flex justify-center">
              <TabsList>
                <TabsTrigger value="explore">Explore repositories</TabsTrigger>
                <TabsTrigger value="features">What you get</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="explore">
              <Explorer onAnalyze={onAnalyze} />
            </TabsContent>
            <TabsContent value="features" className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {FEATURES.map(({ icon: Icon, title, text }) => (
                  <Card key={title} size="sm">
                    <CardHeader>
                      <Icon className="mb-1 size-5 text-chart-1" />
                      <CardTitle>{title}</CardTitle>
                      <CardDescription>{text}</CardDescription>
                    </CardHeader>
                  </Card>
                ))}
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Repositories are cloned read-only into a local cache folder. Nothing is uploaded anywhere.
              </p>
            </TabsContent>
          </Tabs>
        )}
      </main>
      <footer className="pb-8 text-center">
        <ApiBudget />
      </footer>
    </div>
  );
}
