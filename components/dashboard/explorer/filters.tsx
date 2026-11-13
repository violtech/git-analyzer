"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ExplorePeriod, ExploreSort } from "@/lib/explore";
import { DEFAULT_FILTERS, LANGUAGES, PERIODS, QUICK_TOPICS, SORTS, type Filters } from "./constants";
import { TopicPicker } from "./topic-picker";

interface Props {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
}

function ActiveFilter({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:outline-2"
      >
        <X className="size-3" />
      </button>
    </Badge>
  );
}

export function ExplorerFilters({ filters, onChange, onReset }: Props) {
  const customized =
    filters.topic !== DEFAULT_FILTERS.topic || filters.language !== DEFAULT_FILTERS.language;

  return (
    <div className="space-y-3">
      {/* Row 1: what time window, how to rank, which language */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filters.period} onValueChange={(v) => onChange({ period: v as ExplorePeriod })}>
          <TabsList aria-label="Period">
            {(Object.keys(PERIODS) as ExplorePeriod[]).map((p) => (
              <TabsTrigger key={p} value={p}>{PERIODS[p]}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            items={LANGUAGES}
            value={filters.language || "any"}
            onValueChange={(v) => onChange({ language: !v || v === "any" ? "" : v })}
          >
            <SelectTrigger size="sm" className="w-40" aria-label="Language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LANGUAGES).map(([v, label]) => (
                <SelectItem key={v} value={v}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select items={SORTS} value={filters.sort} onValueChange={(v) => v && onChange({ sort: v as ExploreSort })}>
            <SelectTrigger size="sm" className="w-40" aria-label="Sort by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORTS) as ExploreSort[]).map((s) => (
                <SelectItem key={s} value={s}>{SORTS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Row 2: topics, quick chips first and the long tail in a searchable picker */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Topic</span>
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={1}
          className="flex-wrap"
          value={filters.topic ? [filters.topic] : []}
          onValueChange={(v) => onChange({ topic: v[0] ?? "" })}
          aria-label="Topic"
        >
          {QUICK_TOPICS.map((t) => (
            <ToggleGroupItem key={t} value={t} className="rounded-full">{t}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <TopicPicker value={filters.topic} onChange={(topic) => onChange({ topic })} />
      </div>

      {/* Row 3: what is currently applied, removable */}
      {customized && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Filters</span>
          {filters.topic && <ActiveFilter label={`topic: ${filters.topic}`} onRemove={() => onChange({ topic: "" })} />}
          {filters.language && <ActiveFilter label={filters.language} onRemove={() => onChange({ language: "" })} />}
          <Button variant="ghost" size="xs" onClick={onReset}>Reset</Button>
        </div>
      )}
    </div>
  );
}
