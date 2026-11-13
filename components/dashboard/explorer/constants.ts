import type { ExplorePeriod, ExploreSort } from "@/lib/explore";

export interface Filters {
  period: ExplorePeriod;
  sort: ExploreSort;
  /** "" = any topic */
  topic: string;
  /** "" = any language */
  language: string;
}

export const DEFAULT_FILTERS: Filters = { period: "all", sort: "stars", topic: "", language: "" };

/** "all" ranks the most-starred repositories ever; the others only look at repositories created in that window. */
export const PERIODS: Record<ExplorePeriod, string> = { all: "Most starred", year: "New this year", month: "New this month", week: "New this week" };
export const SORTS: Record<ExploreSort, string> = { stars: "Most stars", updated: "Recently updated" };

/** Select items use "any" because an empty string is not a usable item value. */
export const LANGUAGES: Record<string, string> = {
  any: "Any language",
  TypeScript: "TypeScript",
  Python: "Python",
  Rust: "Rust",
  Go: "Go",
  JavaScript: "JavaScript",
  Java: "Java",
  "C++": "C++",
  Swift: "Swift",
  Kotlin: "Kotlin",
};

/** Always-visible shortcuts. */
export const QUICK_TOPICS = ["ai", "llm", "agents", "typescript", "rust", "devtools"];

/** Long tail, shown grouped in the topic picker. */
export const TOPIC_GROUPS: Record<string, string[]> = {
  "AI & data": ["mcp", "machine-learning", "rag", "database", "data-science"],
  "Web & apps": ["react", "nextjs", "self-hosted", "mobile", "game"],
  "Infra & tools": ["cli", "docker", "kubernetes", "security", "automation", "open-source"],
};
