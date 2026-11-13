#!/usr/bin/env tsx
// Headless access to everything the dashboard does. Output is JSON on stdout; progress and errors go to stderr.
//   npm run ga -- help
//   npm run ga -- report owner/repo --sections summary,ai
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

// Storage (.cache, agents.config.json) always lives in the project root, whatever folder the CLI runs from.
const ROOT = path.resolve(path.dirname(path.resolve(process.argv[1] ?? ".")), "..");
const ORIGINAL_CWD = process.cwd();
process.env.GIT_ANALYTICS_HOME ??= ROOT;

const SECTION_NAMES = ["summary", "timeline", "velocity", "releases", "intervals", "pulls", "people", "ai", "detection", "bulk", "pulse", "stability", "quarters", "mergeStyle", "heatmap"];

const COMMANDS = {
  analyze: {
    usage: "ga analyze <repo> [--pin SHA] [--agents-config FILE] [--rules-dir DIR] [--clone-timeout-min N] [--refresh] [--progress]",
    does: "Clone (first time) and read the history, then print a short summary. Uses no GitHub API. --refresh fetches new commits.",
  },
  report: {
    usage: "ga report <repo> [--period week|month|quarter|year] [--range 1|2|5|all] [--kind all|developers|ai|bots] [--exclude-bulk] [--sections a,b] [--pulls] [--pulls-full] [--as-of YYYY-MM-DD] [--pin SHA] [--quarters N] [--releasing-days N] [--active-days N] [--agents-config FILE] [--rules-dir DIR] [--clone-timeout-min N] [--limit N] [--refresh] [--progress]",
    does: "Everything the dashboard shows, as JSON. Same code and same numbers as the UI. Sections: " + SECTION_NAMES.join(", ") + ".",
  },
  explore: {
    usage: "ga explore [--period all|year|month|week] [--topic T] [--language L] [--sort stars|updated] [--page N]",
    does: "Find repositories to analyze (GitHub search; cached, rate-limit aware).",
  },
  pulls: {
    usage: "ga pulls <owner/repo> [--full] [--raw]",
    does: "Pull request lead time. Default: last 12 months. --full walks the whole history. --raw includes every PR.",
  },
  sample: {
    usage: "ga sample [--list samples/example.json] [--out snapshots] [--as-of YYYY-MM-DD] [--no-info] [--wait-for-rate-limit] [--sections a,b] [--timeout-min N] [--quarters N] [--agents-config FILE] [--rules-dir DIR] [--clone-timeout-min N] [--refresh] [--progress]",
    does: "Analyze every repository in a saved list and write a dated snapshot per repository (plus stars from the GitHub API) into snapshots/YYYY-MM/. Resumable: run it again and repositories already complete for that month, asOf and rules are skipped; one failing repository never stops the run. Exit 0 all ok, 3 some failed, 2 GitHub rate limit left stars missing. Run by hand: nothing is scheduled. Needs no token for ~50 repos; set GITHUB_TOKEN (read-only) for larger lists.",
  },
  budget: { usage: "ga budget", does: "Remaining GitHub API budget (checking costs nothing)." },
  agents: {
    usage: "ga agents list | ga agents add <ai|bot|human> <name> | ga agents remove <ai|bot|human> <name> [--agents-config FILE | --rules-dir DIR]",
    does: "Show or edit agents.config.json: exact names always treated as AI agents, bots, or humans. Cached analyses re-classify automatically on next use, with no network.",
  },
  describe: { usage: "ga describe", does: "Machine-readable list of commands, flags and report sections." },
} as const;

type Cmd = keyof typeof COMMANDS;

class UsageError extends Error {}

function help(): string {
  const lines = ["git-analytics CLI: every dashboard action, without a browser.", "", "Run with:  npm run ga -- <command> ...", ""];
  for (const c of Object.values(COMMANDS)) lines.push(`  ${c.usage}`, `      ${c.does}`, "");
  lines.push(
    "<repo> is a GitHub URL, owner/name, or a path to a local git repository.",
    "Output: JSON on stdout. Progress (--progress) and errors go to stderr. Exit code 0 ok, 1 error, 2 GitHub rate limit, 3 (sample only) some repositories failed.",
    "Set GITHUB_TOKEN to raise GitHub API limits.",
  );
  return lines.join("\n");
}

/** A local folder given relatively ("." or "../x") is resolved against where the CLI was started. */
function resolveRepoArg(arg: string): string {
  if (/^[\w.-]+\/[\w.-]+$/.test(arg) && !fs.existsSync(path.resolve(ORIGINAL_CWD, arg, ".git"))) return arg;
  if (/^https?:\/\//i.test(arg) || /github\.com\//i.test(arg)) return arg;
  const abs = path.resolve(ORIGINAL_CWD, arg);
  return fs.existsSync(abs) ? abs : arg;
}

const out = (v: unknown) => process.stdout.write(JSON.stringify(v, null, 2) + "\n");

function oneOf<T extends string>(name: string, v: string | undefined, allowed: readonly T[], fallback: T): T {
  if (v === undefined) return fallback;
  if (!allowed.includes(v as T)) throw new UsageError(`Invalid --${name} "${v}". Use one of: ${allowed.join(", ")}`);
  return v as T;
}

function progressPrinter(on: boolean | undefined) {
  return on ? (e: { stage: string; message: string }) => process.stderr.write(`[${e.stage}] ${e.message}\n`) : undefined;
}

/** A malformed flag (unknown option, missing value) is a usage error like any other, not a crash. */
function parseOrUsage<T>(parse: () => T): T {
  try {
    return parse();
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
}

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") return void process.stdout.write(help() + "\n");
  if (!(command in COMMANDS)) throw new UsageError(`Unknown command "${command}". Run: ga help`);

  const { values, positionals } = parseOrUsage(() =>
    parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      refresh: { type: "boolean" },
      progress: { type: "boolean" },
      period: { type: "string" },
      range: { type: "string" },
      kind: { type: "string" },
      "exclude-bulk": { type: "boolean" },
      sections: { type: "string" },
      pulls: { type: "boolean" },
      "pulls-full": { type: "boolean" },
      limit: { type: "string" },
      "as-of": { type: "string" },
      topic: { type: "string" },
      language: { type: "string" },
      sort: { type: "string" },
      page: { type: "string" },
      full: { type: "boolean" },
      raw: { type: "boolean" },
      list: { type: "string" },
      out: { type: "string" },
      "no-info": { type: "boolean" },
      pin: { type: "string" },
      quarters: { type: "string" },
      "wait-for-rate-limit": { type: "boolean" },
      "releasing-days": { type: "string" },
      "active-days": { type: "string" },
      "timeout-min": { type: "string" },
      "agents-config": { type: "string" },
      "rules-dir": { type: "string" },
      "clone-timeout-min": { type: "string" },
    },
  }));

  // rule files can live outside this repository; the library reads these when it runs
  if (values["agents-config"] !== undefined) {
    const f = path.resolve(ORIGINAL_CWD, values["agents-config"]);
    if (command !== "agents" && !fs.existsSync(f)) throw new UsageError(`--agents-config file not found: ${f}`);
    process.env.GIT_ANALYTICS_AGENTS_CONFIG = f;
  }
  if (values["rules-dir"] !== undefined) {
    const d = path.resolve(ORIGINAL_CWD, values["rules-dir"]);
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) throw new UsageError(`--rules-dir folder not found: ${d}`);
    process.env.GIT_ANALYTICS_RULES_DIR = d;
  }
  if (values["clone-timeout-min"] !== undefined) {
    if (!(Number(values["clone-timeout-min"]) > 0)) throw new UsageError("--clone-timeout-min must be a positive number of minutes");
    process.env.GIT_ANALYTICS_CLONE_TIMEOUT_MIN = values["clone-timeout-min"];
  }

  switch (command as Cmd) {
    case "describe":
      return out({
        commands: COMMANDS,
        sections: SECTION_NAMES,
        periods: ["week", "month", "quarter", "year"],
        ranges: ["1", "2", "5", "all"],
        kinds: ["all", "developers", "ai", "bots"],
        env: { GITHUB_TOKEN: "optional; raises GitHub API limits" },
      });

    case "sample": {
      const sections = values.sections?.split(",").map((s) => s.trim()).filter(Boolean);
      for (const s of sections ?? []) if (!SECTION_NAMES.includes(s)) throw new UsageError(`Invalid section "${s}". Use: ${SECTION_NAMES.join(", ")}`);
      const { parseAsOf } = await import("../lib/report");
      const asOf = values["as-of"] ? parseAsOf(values["as-of"]) : undefined;
      if (values["as-of"] && Number.isNaN(asOf)) throw new UsageError("--as-of must be a date like 2026-10-30");
      const timeoutMin = values["timeout-min"] === undefined ? undefined : Number(values["timeout-min"]);
      if (timeoutMin !== undefined && !(timeoutMin > 0)) throw new UsageError("--timeout-min must be a positive number of minutes");
      const sampleQuarters = values.quarters === undefined ? undefined : Number(values.quarters);
      if (sampleQuarters !== undefined && !(Number.isInteger(sampleQuarters) && sampleQuarters >= 1 && sampleQuarters <= 40)) throw new UsageError("--quarters must be a whole number from 1 to 40");
      const { runSample } = await import("../lib/sample");
      const res = await runSample({
        list: values.list ?? "samples/example.json",
        outDir: values.out ?? "snapshots",
        refresh: !!values.refresh,
        info: !values["no-info"],
        asOf,
        timeoutMin,
        quarters: sampleQuarters,
        waitForRateLimit: !!values["wait-for-rate-limit"],
        sections: sections as never,
        onProgress: values.progress ? (m) => process.stderr.write(m + "\n") : undefined,
      });
      out(res);
      if (res.summary.failed.length) process.exitCode = res.rows.every((r) => !r.ok) ? 1 : 3;
      else if (res.rateLimited) process.exitCode = 2;
      return;
    }

    case "budget": {
      const { getBudget } = await import("../lib/github-client");
      return out(await getBudget());
    }

    case "agents": {
      const { changeOverride, loadOverrides, OVERRIDE_LISTS } = await import("../lib/overrides");
      const [op, list, ...nameParts] = positionals;
      if (!op || op === "list") return out(await loadOverrides());
      if (op !== "add" && op !== "remove") throw new UsageError("Use: ga agents list | add <ai|bot|human> <name> | remove <ai|bot|human> <name>");
      if (!OVERRIDE_LISTS.includes(list as never)) throw new UsageError(`List must be one of: ${OVERRIDE_LISTS.join(", ")}`);
      return out(await changeOverride(op, list as never, nameParts.join(" ")));
    }

    case "explore": {
      const { explore } = await import("../lib/explore");
      return out(
        await explore({
          period: oneOf("period", values.period, ["all", "year", "month", "week"] as const, "all"),
          topic: values.topic ?? "",
          language: values.language ?? "",
          sort: oneOf("sort", values.sort, ["stars", "updated"] as const, "stars"),
          page: Number(values.page ?? 1),
        }),
      );
    }

    case "pulls": {
      const repo = positionals[0];
      if (!repo) throw new UsageError("Usage: " + COMMANDS.pulls.usage);
      const { fetchPulls } = await import("../lib/github");
      const { aggregatePulls, median } = await import("../lib/aggregate");
      const stats = await fetchPulls(repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, ""), !!values.full);
      const merged = stats.prs.filter((p) => p.merged);
      return out({
        ...(values.raw ? stats : { ...stats, prs: undefined }),
        merged: merged.length,
        closedUnmerged: stats.prs.length - merged.length,
        medianDaysToMerge: median(merged.map((p) => (p.closed - p.created) / 86400)),
        perMonth: aggregatePulls(stats.prs, "month"),
      });
    }

    case "analyze":
    case "report": {
      const repoArg = positionals[0];
      if (!repoArg) throw new UsageError("Usage: " + COMMANDS[command as "analyze" | "report"].usage);
      const { parseAsOf } = await import("../lib/report");
      // validate everything before any clone or network work, so a typo fails instantly
      const reportOpts =
        command === "report"
          ? {
              period: oneOf("period", values.period, ["week", "month", "quarter", "year"] as const, "month"),
              range: oneOf("range", values.range, ["1", "2", "5", "all"] as const, "all"),
              kind: oneOf("kind", values.kind, ["all", "developers", "ai", "bots"] as const, "all"),
              excludeBulk: !!values["exclude-bulk"],
              sections: values.sections?.split(",").map((s) => s.trim()).filter(Boolean),
              limit: values.limit ? Number(values.limit) : undefined,
              asOf: values["as-of"] ? parseAsOf(values["as-of"]) : undefined,
              quarters: values.quarters === undefined ? undefined : { count: Number(values.quarters) },
              status: {
                releasingDays: values["releasing-days"] === undefined ? undefined : Number(values["releasing-days"]),
                activeDays: values["active-days"] === undefined ? undefined : Number(values["active-days"]),
              },
            }
          : null;
      for (const s of reportOpts?.sections ?? []) if (!SECTION_NAMES.includes(s)) throw new UsageError(`Invalid section "${s}". Use: ${SECTION_NAMES.join(", ")}`);
      if (values["as-of"] && Number.isNaN(reportOpts?.asOf)) throw new UsageError("--as-of must be a date like 2026-10-30");
      if (reportOpts?.limit !== undefined && !(reportOpts.limit > 0)) throw new UsageError("--limit must be a positive number");
      if (reportOpts?.quarters && !(Number.isInteger(reportOpts.quarters.count) && reportOpts.quarters.count! >= 1 && reportOpts.quarters.count! <= 40)) throw new UsageError("--quarters must be a whole number from 1 to 40");
      for (const [flag, v] of [["--releasing-days", reportOpts?.status.releasingDays], ["--active-days", reportOpts?.status.activeDays]] as const) {
        if (v !== undefined && !(v > 0)) throw new UsageError(`${flag} must be a positive number of days`);
      }
      if (values.pin !== undefined && !/^[0-9a-f]{7,40}$/i.test(values.pin)) throw new UsageError("--pin must be a commit sha (7-40 hex characters)");

      const { analyze } = await import("../lib/git");
      const data = await analyze(resolveRepoArg(repoArg), !!values.refresh, progressPrinter(values.progress), { pin: values.pin });

      if (command === "analyze") {
        return out({
          repo: data.repo,
          branch: data.branch,
          analyzedAt: new Date(data.fetchedAt).toISOString(),
          commits: data.commits.length,
          authors: data.authors.length,
          aiAgents: data.agents,
          stableReleases: data.releases.filter((r) => r.stable).length,
          preReleaseBuilds: data.releases.filter((r) => r.pre).length,
          packageTagsIgnored: data.packageTags,
          bulkCommits: data.commits.filter((c) => c.b).length,
          classifier: data.classifier,
          headSha: data.headSha ?? null,
          pinned: !!data.pinned,
        });
      }

      const { buildFullReport } = await import("../lib/full-report");

      let pulls = null;
      if (values.pulls || values["pulls-full"]) {
        if (!data.source.startsWith("https://github.com/")) throw new UsageError("Pull request stats need a GitHub repository");
        const { fetchPulls } = await import("../lib/github");
        pulls = await fetchPulls(data.repo, !!values["pulls-full"]);
      }

      return out(
        await buildFullReport(data, pulls, { ...reportOpts, sections: reportOpts?.sections as never }),
      );
    }
  }
}

main(process.argv.slice(2)).catch(async (e: Error) => {
  let code = 1;
  let extra: Record<string, unknown> = {};
  try {
    const { RateLimitError } = await import("../lib/github-client");
    if (e instanceof RateLimitError) {
      code = 2;
      extra = { code: "RATE_LIMIT", resetAt: new Date(e.resetAt * 1000).toISOString() };
    }
  } catch {}
  if (e instanceof UsageError) extra = { code: "USAGE" };
  process.stderr.write(JSON.stringify({ error: e.message, ...extra }) + "\n");
  process.exit(code);
});
