import { promises as fs } from "node:fs";
import type { AgentOverrides } from "./agents";
import { agentsConfigFile, releaseRulesFile, shippedRulesFile } from "./home";
import type { ReleaseRules } from "./tags";

export type OverrideList = "ai" | "bot" | "human";
export const OVERRIDE_LISTS: OverrideList[] = ["ai", "bot", "human"];

/** Everything a rules file can say about one repository ("owner/name"). One entry, one place. */
export interface RepoRules extends ReleaseRules {
  /** path patterns (root-relative) left out of code size and lines added, e.g. a vendored copy of another project */
  vendored?: string[];
  /** names that count as AI / bot / human in this repository only; global names keep working */
  agents?: AgentOverrides;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** The global agent-name list (--agents-config, or agents.config.json in the rules folder). */
export async function loadOverrides(): Promise<AgentOverrides> {
  return (await readJson<AgentOverrides>(agentsConfigFile())) ?? {};
}

/** Adds (or removes) one exact name in a list. Names are matched case-insensitively. Returns the new file contents. */
export async function changeOverride(op: "add" | "remove", list: OverrideList, name: string): Promise<Required<AgentOverrides>> {
  const clean = name.trim();
  if (!clean) throw new Error("Name is empty");
  const cur = await loadOverrides();
  const next: Required<AgentOverrides> = { ai: [...(cur.ai ?? [])], bot: [...(cur.bot ?? [])], human: [...(cur.human ?? [])] };
  const same = (x: string) => x.toLowerCase() === clean.toLowerCase();
  if (op === "add") {
    // a name lives in exactly one list
    for (const l of OVERRIDE_LISTS) next[l] = next[l].filter((x) => !same(x));
    next[list].push(clean);
  } else {
    next[list] = next[list].filter((x) => !same(x));
  }
  await fs.writeFile(agentsConfigFile(), JSON.stringify(next, null, 2) + "\n");
  return next;
}

/**
 * Rules for one repository ("owner/name", case-insensitive). The rules shipped with the analyzer apply first; an entry
 * for the same repository in the rules folder replaces it. Undefined when no file mentions the repository.
 */
export async function loadRepoRules(repo: string): Promise<RepoRules | undefined> {
  const key = repo.toLowerCase();
  const find = (all: Record<string, RepoRules> | undefined) => (all ? Object.entries(all).find(([k]) => k.toLowerCase() === key)?.[1] : undefined);
  const shipped = find(await readJson<Record<string, RepoRules>>(shippedRulesFile()));
  const mine = releaseRulesFile() === shippedRulesFile() ? undefined : find(await readJson<Record<string, RepoRules>>(releaseRulesFile()));
  return mine ?? shipped;
}

/** Global agent names plus the ones that apply to this repository only. */
export function mergeAgentOverrides(global: AgentOverrides, repo: AgentOverrides | undefined): AgentOverrides {
  if (!repo) return global;
  const union = (a?: string[], b?: string[]) => [...new Set([...(a ?? []), ...(b ?? [])])];
  return { ai: union(global.ai, repo.ai), bot: union(global.bot, repo.bot), human: union(global.human, repo.human) };
}
