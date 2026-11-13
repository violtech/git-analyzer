"use client";

import { useEffect, useState } from "react";
import { Loader2, SearchX } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtNum } from "@/lib/aggregate";
import type { ExploreRepo } from "@/lib/explore";
import { DEFAULT_FILTERS, type Filters } from "./constants";
import { ExplorerFilters } from "./filters";
import { RepoCard } from "./repo-card";

interface Result {
  key: string;
  items: ExploreRepo[];
  total: number;
  page: number;
  error: string | null;
}

const MAX_PAGES = 20;
/** GitHub search only exposes the first 1,000 matches. */
const REACHABLE = 1000;

function query(f: Filters, page: number) {
  return new URLSearchParams({ period: f.period, sort: f.sort, topic: f.topic, language: f.language, page: String(page) });
}

export function Explorer({ onAnalyze }: { onAnalyze: (repo: string) => void }) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [result, setResult] = useState<Result | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const key = JSON.stringify(filters);
  const loading = result?.key !== key;

  useEffect(() => {
    const ctrl = new AbortController();
    // debounce: clicking through filters should not spend one search request per click
    const timer = setTimeout(() => fetch(`/api/explore?${query(filters, 1)}`, { signal: ctrl.signal })
      .then(async (res) => {
        const json = await res.json();
        setResult({
          key,
          items: res.ok ? json.items : [],
          total: res.ok ? json.total : 0,
          page: 1,
          error: res.ok ? null : (json.error ?? "Request failed"),
        });
      })
      .catch((e) => {
        if (e.name !== "AbortError") setResult({ key, items: [], total: 0, page: 1, error: "Could not reach GitHub" });
      }), 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [filters, key]);

  async function loadMore() {
    if (!result) return;
    const page = result.page + 1;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/explore?${query(filters, page)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      setResult((r) => (r && r.key === key ? { ...r, items: [...r.items, ...json.items], page } : r));
    } catch (e) {
      setResult((r) => (r && r.key === key ? { ...r, error: (e as Error).message } : r));
    } finally {
      setLoadingMore(false);
    }
  }

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));
  const reset = () => setFilters(DEFAULT_FILTERS);

  const shown = loading ? 0 : (result?.items.length ?? 0);
  const canLoadMore = !loading && !!result && !result.error && shown < Math.min(result.total, REACHABLE) && result.page < MAX_PAGES;

  return (
    <section className="space-y-5 text-left" aria-labelledby="explore-title">
      <div className="space-y-1 text-center">
        <h2 id="explore-title" className="text-xl font-semibold tracking-tight">Explore repositories</h2>
        <p className="mx-auto max-w-xl text-sm text-muted-foreground">
          Find a project to analyze. Most starred ranks by stars overall; New shows the most-starred repositories created in that period. Pick a topic to see its top repositories.
        </p>
      </div>

      <ExplorerFilters filters={filters} onChange={patch} onReset={reset} />

      <div className="flex items-center justify-between text-xs text-muted-foreground" aria-live="polite">
        <span>
          {loading
            ? "Searching…"
            : result && !result.error
              ? result.total > REACHABLE
                ? `Top ${fmtNum(shown)} of ${fmtNum(result.total)} matches`
                : `Showing ${fmtNum(shown)} of ${fmtNum(result.total)} repositories`
              : ""}
        </span>
      </div>

      {result?.error && !loading && (
        <Alert variant="destructive">
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-52" />)}
        </div>
      ) : result && result.items.length > 0 ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((r) => (
              <RepoCard
                key={r.fullName}
                repo={r}
                activeTopic={filters.topic}
                onAnalyze={onAnalyze}
                onTopic={(topic) => patch({ topic })}
              />
            ))}
          </div>
          {canLoadMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore && <Loader2 className="animate-spin" />}
                {loadingMore ? "Loading" : "Show more"}
              </Button>
            </div>
          )}
        </>
      ) : (
        !result?.error && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><SearchX /></EmptyMedia>
              <EmptyTitle>No repositories match</EmptyTitle>
              <EmptyDescription>Try a longer period, another topic, or remove a filter.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={reset}>Reset filters</Button>
            </EmptyContent>
          </Empty>
        )
      )}
    </section>
  );
}
