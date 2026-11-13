import { promises as fs } from "node:fs";
import path from "node:path";
import { analyze, currentRules, withTimeout } from "./git";
import { fetchRepoInfo, type RepoInfo } from "./github";
import { RateLimitError, getBudget, type Budget } from "./github-client";
import { buildFullReport } from "./full-report";
import { HOME } from "./home";
import type { ReportOptions, Section } from "./report";
import type { Analysis } from "./types";

// A saved sample of repositories, measured the same way each time and written as a dated snapshot, so months
// can be compared. It is run by hand (`ga sample`); nothing here schedules itself.
// A run can be interrupted and started again: repositories already complete for the same month, asOf and rules are skipped.

export interface SampleList {
  repos: string[];
}

export interface SampleRow {
  repo: string;
  ok: boolean;
  /** done = analysed in this run, skipped = already complete from an earlier run, failed = see error */
  status: "done" | "skipped" | "failed";
  error?: string;
  stars?: number | null;
  commits?: number;
  /** AI-assisted share of all commits ever (lower bound) */
  aiShareAllTimePct?: number | null;
  /** AI-assisted share in the 12 months before asOf, and in the 12 months before that (lower bound) */
  aiShareLast12MonthsPct?: number | null;
  aiSharePrev12MonthsPct?: number | null;
  /** source-code lines only; tests, docs and data are in the snapshot file's codeBreakdown */
  codeLines?: number;
  /** number of AI tools the project keeps instruction files for (AGENTS.md, CLAUDE.md, ...) */
  agentInstructionTools?: number;
  stableReleasesLast12Months?: number;
  versionStyle?: string;
  /** releasing / developing / quiet */
  projectStatus?: string;
  file?: string;
}

/** The few report fields the index needs. */
interface SampleReport {
  summary?: { commits?: number; aiSharePct?: number | null; codeLines?: number };
  ai?: { instructionFiles?: unknown[] };
  pulse?: { status?: string };
  stability?: { releases?: { last12Months?: number }; versionStyle?: string; aiSharePct?: { last12Months?: number | null; previous12Months?: number | null } };
}

export interface SampleSummary {
  succeeded: string[];
  skipped: string[];
  failed: { repo: string; reason: string }[];
}

export interface SampleResult {
  takenAt: string;
  /** the reference date of the measurements; equals takenAt unless --as-of was given */
  asOf: string;
  month: string;
  dir: string;
  authenticated: boolean;
  /** false in the index of an interrupted run */
  complete: boolean;
  /** the GitHub API budget ran out, so some stars are missing; run again to fill them in */
  rateLimited: boolean;
  summary: SampleSummary;
  rows: SampleRow[];
}

const slug = (repo: string) => repo.replace("/", "__").toLowerCase();

export async function loadSampleList(file: string): Promise<SampleList> {
  const p = path.isAbsolute(file) ? file : path.join(HOME, file);
  let parsed: SampleList;
  try {
    parsed = JSON.parse(await fs.readFile(p, "utf8"));
  } catch (e) {
    throw new Error(`Cannot read sample list ${p}: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed.repos) || parsed.repos.some((r) => typeof r !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(r))) {
    throw new Error(`${p} must look like {"repos": ["owner/name", ...]}`);
  }
  return parsed;
}

/** Everything a run needs from outside; replaced in tests so the resume logic is checked without a network. */
export interface SampleDeps {
  analyze: (repo: string, refresh: boolean) => Promise<Analysis>;
  report: (data: Analysis, opts: ReportOptions) => Promise<unknown>;
  rules: (repo: string) => Promise<{ schema: number; classifier: string; releaseRulesId: string; vendoredId?: string }>;
  info: (repo: string) => Promise<RepoInfo>;
  /** the current GitHub core budget (asks the free /rate_limit endpoint), or null if unknown */
  budget: () => Promise<Budget | null>;
  /** wait; replaced in tests so a pause does not take real time */
  sleep: (ms: number) => Promise<void>;
}

const realDeps: SampleDeps = {
  analyze: (repo, refresh) => analyze(repo, refresh),
  report: (data, opts) => buildFullReport(data, null, opts),
  rules: currentRules,
  info: fetchRepoInfo,
  budget: async () => (await getBudget(true)).core,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export interface SampleOptions {
  list: string;
  outDir: string;
  refresh?: boolean;
  /** fetch stars and repo facts from the GitHub API (one request per repository, cached 12 hours; always one at a time) */
  info?: boolean;
  sections?: Section[];
  /** unix seconds; measure the repositories as they stood then (default: now). The snapshot is filed under that month. */
  asOf?: number;
  /** minutes allowed for one repository (clone, history, snapshots) before it is stopped and counted as failed (default 30) */
  timeoutMin?: number;
  /** calendar quarters in the report's quarterly section, ending with the one that contains asOf (default 4) */
  quarters?: number;
  /** instead of giving up on stars when GitHub's allowance runs low, wait for the window to reset and carry on (default: stop for the rest of the run) */
  waitForRateLimit?: boolean;
  /** with waitForRateLimit: pause once this share of the allowance is used (default 0.8) */
  pauseAtUsedShare?: number;
  onProgress?: (msg: string) => void;
  deps?: Partial<SampleDeps>;
}

interface SnapshotFile {
  takenAt: string;
  asOf: string;
  repo: string;
  /** what the snapshot was produced with; a repository is complete only if all of it matches the current run */
  key: { schema: number; classifier: string; releaseRulesId: string; vendoredId?: string };
  info: RepoInfo | null;
  infoError: string | null;
  report: SampleReport;
}

async function readDone(file: string, asOf: string, key: SnapshotFile["key"], sections: string[], wantInfo: boolean): Promise<SnapshotFile | null> {
  try {
    const x = JSON.parse(await fs.readFile(file, "utf8")) as SnapshotFile;
    const same = x.key && x.key.schema === key.schema && x.key.classifier === key.classifier && x.key.releaseRulesId === key.releaseRulesId && (x.key.vendoredId ?? "") === (key.vendoredId ?? "");
    const hasSections = sections.every((s) => s in (x.report as object));
    if (x.asOf === asOf && same && hasSections && (!wantInfo || x.info)) return x;
  } catch {
    // missing or half-written file: not complete
  }
  return null;
}

function rowFrom(repo: string, status: SampleRow["status"], x: SnapshotFile, file: string): SampleRow {
  const report = x.report;
  return {
    repo,
    ok: true,
    status,
    stars: x.info?.stars ?? null,
    commits: report.summary?.commits,
    aiShareAllTimePct: report.summary?.aiSharePct ?? null,
    aiShareLast12MonthsPct: report.stability?.aiSharePct?.last12Months ?? null,
    aiSharePrev12MonthsPct: report.stability?.aiSharePct?.previous12Months ?? null,
    codeLines: report.summary?.codeLines,
    agentInstructionTools: report.ai?.instructionFiles?.length ?? 0,
    stableReleasesLast12Months: report.stability?.releases?.last12Months,
    versionStyle: report.stability?.versionStyle,
    projectStatus: report.pulse?.status,
    file: path.relative(HOME, file),
    ...(x.infoError ? { error: x.infoError } : {}),
  };
}

/**
 * Analyze every repository in the list, write one JSON file per repository and an index, into snapshots/YYYY-MM/.
 * One repository failing or timing out never stops the run. Running again resumes: complete repositories are skipped.
 */
export async function runSample(opts: SampleOptions): Promise<SampleResult> {
  const deps: SampleDeps = { ...realDeps, ...opts.deps };
  const list = await loadSampleList(opts.list);
  const now = new Date();
  const asOf = opts.asOf ?? now.getTime() / 1000;
  const asOfIso = new Date(asOf * 1000).toISOString();
  const month = asOfIso.slice(0, 7);
  const out = path.isAbsolute(opts.outDir) ? opts.outDir : path.join(HOME, opts.outDir);
  const dir = path.join(out, month);
  await fs.mkdir(dir, { recursive: true });

  const wantInfo = opts.info !== false;
  // the index needs summary, ai, pulse and stability whatever else was asked for
  const sections = opts.sections ? ([...new Set([...opts.sections, "summary", "ai", "pulse", "stability"])] as Section[]) : undefined;
  const required = sections ?? ["summary", "ai", "pulse", "stability"];
  const timeoutMs = (opts.timeoutMin ?? 30) * 60_000;

  const pauseAt = opts.pauseAtUsedShare ?? 0.8;
  /** one line in collect.log and in the progress output */
  const note = async (msg: string) => {
    opts.onProgress?.(msg);
    await fs.appendFile(path.join(dir, "collect.log"), `${new Date().toISOString()} ${msg}\n`).catch(() => undefined);
  };
  const writeState = (state: object | null) =>
    state ? fs.writeFile(path.join(dir, "collect-state.json"), JSON.stringify(state, null, 2)) : fs.rm(path.join(dir, "collect-state.json"), { force: true });
  /** wait until the window resets (plus a few seconds); the state file says where the run stands while it sleeps */
  const waitUntil = async (resetAt: number, why: string, next: string) => {
    const ms = Math.max(0, resetAt * 1000 - Date.now()) + 5000;
    await writeState({ pausedAt: new Date().toISOString(), resumesAt: new Date(Date.now() + ms).toISOString(), reason: why, next });
    await note(`PAUSE ${why}; resuming ${new Date(Date.now() + ms).toISOString()} before ${next}`);
    await deps.sleep(ms);
    await writeState(null);
    await note(`RESUME before ${next}`);
  };
  /** before a GitHub call: if the allowance is mostly used, wait for the reset */
  const pauseIfLow = async (next: string) => {
    const b = await deps.budget().catch(() => null);
    if (!b || !b.limit) return;
    const used = (b.limit - b.remaining) / b.limit;
    if (used >= pauseAt && Date.now() / 1000 < b.reset) await waitUntil(b.reset, `${Math.round(used * 100)}% of the GitHub allowance used (${b.remaining} of ${b.limit} left)`, next);
  };

  const rows: SampleRow[] = [];
  const summary: SampleSummary = { succeeded: [], skipped: [], failed: [] };
  let apiBlocked = false;

  const result = (complete: boolean): SampleResult => ({
    takenAt: now.toISOString(),
    asOf: asOfIso,
    month,
    dir: path.relative(HOME, dir),
    authenticated: !!process.env.GITHUB_TOKEN,
    complete,
    rateLimited: apiBlocked,
    summary,
    rows,
  });
  const writeIndex = (complete: boolean) => fs.writeFile(path.join(dir, "index.json"), JSON.stringify(result(complete), null, 2));

  for (const [i, repo] of list.repos.entries()) {
    const tag = `[${i + 1}/${list.repos.length}] ${repo}`;
    const file = path.join(dir, `${slug(repo)}.json`);
    try {
      const key = await deps.rules(repo);
      if (!opts.refresh) {
        const done = await readDone(file, asOfIso, key, required, wantInfo);
        if (done) {
          opts.onProgress?.(`${tag}: already complete, skipped`);
          rows.push(rowFrom(repo, "skipped", done, file));
          summary.skipped.push(repo);
          await writeIndex(false);
          continue;
        }
      }
      opts.onProgress?.(tag);

      const { data, report } = await withTimeout(timeoutMs, repo, async () => {
        const data = await deps.analyze(repo, !!opts.refresh);
        return { data, report: (await deps.report(data, { sections, asOf, ...(opts.quarters ? { quarters: { count: opts.quarters } } : {}) })) as SampleReport };
      });

      // GitHub requests stay one at a time, and stop for the rest of the run once the budget is gone
      let info: RepoInfo | null = null;
      let infoError: string | null = null;
      if (wantInfo && !apiBlocked) {
        for (let attempt = 0; ; attempt++) {
          try {
            if (opts.waitForRateLimit) await pauseIfLow(data.repo);
            info = await deps.info(data.repo);
            infoError = null;
            break;
          } catch (e) {
            infoError = (e as Error).message;
            if (e instanceof RateLimitError && opts.waitForRateLimit && attempt < 3) {
              await waitUntil(e.resetAt, `GitHub refused the request (${e.resource} limit reached)`, data.repo);
              continue;
            }
            if (e instanceof RateLimitError) apiBlocked = true;
            break;
          }
        }
      } else if (wantInfo && apiBlocked) infoError = "skipped: GitHub API budget exhausted earlier in this run";

      const snap: SnapshotFile = { takenAt: now.toISOString(), asOf: asOfIso, repo: data.repo, key, info, infoError, report };
      // write beside the target and rename, so a killed run never leaves a half-written snapshot that looks complete
      await fs.writeFile(`${file}.tmp`, JSON.stringify(snap, null, 2));
      await fs.rename(`${file}.tmp`, file);

      rows.push(rowFrom(data.repo, "done", snap, file));
      summary.succeeded.push(repo);
    } catch (e) {
      const reason = (e as Error).message;
      rows.push({ repo, ok: false, status: "failed", error: reason });
      summary.failed.push({ repo, reason });
    }
    await writeIndex(false);
  }

  await writeIndex(true);
  return result(true);
}
