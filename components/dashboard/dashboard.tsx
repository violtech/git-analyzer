"use client";

import { useMemo, useState } from "react";
import { GitBranch } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AuthorKind } from "@/lib/agents";
import { streamAnalysis } from "@/lib/stream";
import type { Analysis, Granularity, ProgressEvent, PullStats } from "@/lib/types";
import { buildView, rangeStart, type Range } from "@/lib/view";
import { GRANULARITIES, RANGES } from "./chart-config";
import { ApiBudget } from "./api-budget";
import { BetweenReleasesTab } from "./between-releases-tab";
import { Landing } from "./landing";
import { OverviewTab } from "./overview-tab";
import { PeopleTab } from "./people-tab";
import { ProgressCard } from "./progress-card";
import { PullsTab } from "./pulls-tab";
import { ReleasesTab } from "./releases-tab";
import { StatCards } from "./stat-cards";
import { VelocityTab } from "./velocity-tab";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json as T;
}

export function Dashboard() {
  const [input, setInput] = useState("");
  const [data, setData] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [g, setG] = useState<Granularity>("month");
  const [range, setRange] = useState<Range>("all");
  const [kind, setKind] = useState<AuthorKind>("all");
  const [excludeBulk, setExcludeBulk] = useState(false);
  const [pulls, setPulls] = useState<PullStats | null>(null);
  const [pullsLoading, setPullsLoading] = useState(false);
  const [pullsError, setPullsError] = useState<string | null>(null);

  async function load(refresh = false, repo = input) {
    setInput(repo);
    setLoading(true);
    setProgress(null);
    setError(null);
    setPulls(null);
    setPullsError(null);
    try {
      setData(await streamAnalysis(repo, refresh, setProgress));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadPulls(repo: string, full = false) {
    setPullsLoading(true);
    setPullsError(null);
    try {
      setPulls(await getJson<PullStats>(`/api/pulls?repo=${encodeURIComponent(repo)}${full ? "&full=1" : ""}`));
    } catch (e) {
      setPullsError((e as Error).message);
    } finally {
      setPullsLoading(false);
    }
  }

  const view = useMemo(
    () => (data ? buildView(data, g, rangeStart(data, range), kind, pulls, excludeBulk) : null),
    [data, g, range, kind, pulls, excludeBulk],
  );
  const githubRepo =
    data && data.source.startsWith("https://github.com/") ? data.repo : null;

  if (!data) {
    return (
      <Landing
        input={input}
        onInput={setInput}
        onAnalyze={(repo) => load(false, repo ?? input)}
        loading={loading}
        progress={progress}
        error={error}
      />
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:px-8">
          <button
            type="button"
            className="flex items-center gap-2 rounded-md hover:opacity-80"
            onClick={() => {
              setData(null);
              setError(null);
            }}
            aria-label="Back to start"
          >
            <GitBranch className="size-5" />
            <span className="text-lg font-semibold tracking-tight">Git Analytics</span>
          </button>
          <form
            className="flex w-full gap-2 md:max-w-xl"
            onSubmit={(e) => {
              e.preventDefault();
              load();
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="github.com/owner/repo, owner/repo or C:\path\to\repo"
              aria-label="Repository"
            />
            <Button type="submit" disabled={loading}>{loading ? "Analyzing…" : "Analyze"}</Button>
            {data && (
              <Button type="button" variant="outline" disabled={loading} onClick={() => load(true)}>
                Refresh
              </Button>
            )}
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && <ProgressCard repo={input.replace(/^https?:\/\/github\.com\//, "")} progress={progress} />}

        {!view && !loading && <p className="text-sm text-muted-foreground">No commits found.</p>}

        {view && !loading && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="text-base font-semibold">{data.repo}</span>
                <span className="text-muted-foreground"> · branch {data.branch}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ToggleGroup variant="outline" size="sm" value={[g]} onValueChange={(v) => v[0] && setG(v[0] as Granularity)} aria-label="Period">
                  {GRANULARITIES.map((x) => (
                    <ToggleGroupItem key={x} value={x} className="capitalize">{x}</ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <Separator orientation="vertical" className="h-6" />
                <ToggleGroup variant="outline" size="sm" value={[range]} onValueChange={(v) => v[0] && setRange(v[0] as Range)} aria-label="Range">
                  {(Object.keys(RANGES) as Range[]).map((r) => (
                    <ToggleGroupItem key={r} value={r}>{RANGES[r]}</ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>

            <StatCards view={view} />

            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="velocity">Velocity</TabsTrigger>
                <TabsTrigger value="releases">Releases</TabsTrigger>
                <TabsTrigger value="between">Between releases</TabsTrigger>
                <TabsTrigger value="pulls">Pull requests</TabsTrigger>
                <TabsTrigger value="people">People</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="pt-4"><OverviewTab view={view} data={data} g={g} excludeBulk={excludeBulk} onExcludeBulk={setExcludeBulk} /></TabsContent>
              <TabsContent value="velocity" className="pt-4"><VelocityTab view={view} g={g} /></TabsContent>
              <TabsContent value="releases" className="pt-4"><ReleasesTab view={view} /></TabsContent>
              <TabsContent value="between" className="pt-4"><BetweenReleasesTab view={view} /></TabsContent>
              <TabsContent value="pulls" className="pt-4">
                <PullsTab
                  view={view}
                  githubRepo={githubRepo}
                  pulls={pulls}
                  loading={pullsLoading}
                  error={pullsError}
                  onLoad={(full) => githubRepo && loadPulls(githubRepo, full)}
                />
              </TabsContent>
              <TabsContent value="people" className="pt-4"><PeopleTab view={view} g={g} kind={kind} onKind={setKind} /></TabsContent>
            </Tabs>
          </>
        )}
      </main>
      <footer className="pb-8 text-center">
        <ApiBudget />
      </footer>
    </div>
  );
}
