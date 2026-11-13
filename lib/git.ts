import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { classifyIdentity, isHousekeeping, RULES_VERSION, type AgentOverrides } from "./agents";
import { agentFileTool } from "./agent-files";
import { CATEGORIES, categorize, emptyBreakdown, type Breakdown } from "./categories";
import { CACHE_ROOT } from "./home";
import { globMatcher } from "./glob";
import { loadOverrides, loadRepoRules, mergeAgentOverrides } from "./overrides";
import { BULK_COMMIT_LINES, isBulkDataFile, isIgnoredPath, newPathOf } from "./paths";
import { classifyTag, mainLinePrefix, releaseKey, releaseStyle, type ReleaseRules, type ReleaseStyle } from "./tags";
import type { Analysis, BulkCommit, CommitRow, ProgressEvent, ReleaseRow } from "./types";

export type ProgressFn = (e: ProgressEvent) => void;

const CACHE_DIR = CACHE_ROOT;
/** Shape of the cached JSON. Bump when Analysis changes. */
export const SCHEMA = 7;

/** Changes whenever the classification rules or the overrides file change. */
function classifierId(overrides: AgentOverrides) {
  return `${RULES_VERSION}:${createHash("sha1").update(JSON.stringify(overrides)).digest("hex").slice(0, 8)}`;
}

/** GitHub's "12345+login@users.noreply.github.com" and "login@users.noreply.github.com" are the same person. */
function identityKey(name: string, email: string): string {
  const e = email.trim().toLowerCase().replace(/^\d+\+/, "");
  return e || `name:${name.toLowerCase()}`;
}

/** Lets a caller cancel every git process started inside `withTimeout`, without threading a signal through each call. */
const abortScope = new AsyncLocalStorage<AbortSignal>();

/** Runs fn; if it takes longer than `ms`, every git process it started is killed and the promise rejects. */
export async function withTimeout<T>(ms: number, label: string, fn: () => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const parent = abortScope.getStore();
  const timer = setTimeout(() => ctl.abort(), ms);
  const timedOut = new Promise<never>((_, reject) =>
    ctl.signal.addEventListener("abort", () => reject(new Error(`${label} timed out after ${Math.max(1, Math.round(ms / 60000))} min`))),
  );
  try {
    return await Promise.race([abortScope.run(parent ? AbortSignal.any([parent, ctl.signal]) : ctl.signal, fn), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Git is only ever used to read history. Settings applied to every call so nothing in a repository can run code or reach the network
 * by surprise: hooks off, no filesystem monitor, no submodule recursion, only https remotes, never ask for a password.
 */
const SAFE_CONFIG = [
  "core.hooksPath=/dev/null",
  "core.fsmonitor=false",
  "submodule.recurse=false",
  "protocol.allow=never",
  "protocol.https.allow=always",
  "gc.auto=0",
];
export const SAFE_GIT_ARGS = SAFE_CONFIG.flatMap((c) => ["-c", c]);

function spawnGit(args: string[], cwd?: string, extraConfig: string[] = []) {
  return spawn("git", [...SAFE_GIT_ARGS, ...extraConfig.flatMap((c) => ["-c", c]), ...args], {
    cwd,
    windowsHide: true,
    signal: abortScope.getStore(),
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo", GCM_INTERACTIVE: "never" },
  });
}

function run(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawnGit(args, cwd);
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks).toString("utf8"))
        : reject(new Error(`git ${args[0]} failed: ${err.trim().slice(0, 300)}`)),
    );
  });
}

/** Runs git with --progress and reports "Receiving objects: 45%" style lines from stderr. */
function runWithProgress(args: string[], cwd: string | undefined, stage: "clone" | "fetch", onProgress?: ProgressFn, extraConfig: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawnGit(args, cwd, extraConfig);
    let err = "";
    let last = -1;
    p.stderr.setEncoding("utf8");
    p.stderr.on("data", (d: string) => {
      err = (err + d).slice(-600);
      for (const line of d.split(/[\r\n]+/)) {
        const m = line.match(/^(?:remote: )?([A-Za-z ]+):\s+(\d+)%/);
        if (!m || !onProgress) continue;
        const pct = Number(m[2]);
        // Receiving objects is the bulk of a clone; the other phases are quick.
        if (m[1] === "Receiving objects" && pct !== last) {
          last = pct;
          onProgress({ stage, pct, message: stage === "clone" ? `Downloading repository history (${pct}%)` : `Downloading new commits (${pct}%)` });
        } else if (m[1] === "Resolving deltas" && pct === 100) {
          onProgress({ stage, pct: 100, message: "Unpacking history" });
        }
      }
    });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git ${args[0]} failed: ${err.trim().slice(0, 300)}`))));
  });
}

export interface Target {
  /** display name */
  repo: string;
  /** clone url or local path */
  source: string;
  local: boolean;
  slug: string;
}

export async function resolveTarget(input: string): Promise<Target> {
  const raw = input.trim();
  if (!raw) throw new Error("Enter a GitHub URL, owner/name, or a local path");

  const gh =
    raw.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i) ??
    raw.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (gh) {
    const [, owner, name] = gh;
    return {
      repo: `${owner}/${name}`,
      source: `https://github.com/${owner}/${name}.git`,
      local: false,
      slug: `${owner}__${name}`.toLowerCase(),
    };
  }

  if (path.isAbsolute(raw)) {
    try {
      await run(["rev-parse", "--git-dir"], raw);
    } catch {
      throw new Error("That folder is not a git repository");
    }
    return {
      repo: path.basename(raw),
      source: raw,
      local: true,
      slug: "local__" + raw.replace(/[^\w]+/g, "_").toLowerCase(),
    };
  }
  throw new Error("Use a github.com URL, owner/name, or an absolute local path");
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Minutes a clone or fetch may take before it is stopped (GIT_ANALYTICS_CLONE_TIMEOUT_MIN, default 30). */
const cloneTimeoutMs = () => (Number(process.env.GIT_ANALYTICS_CLONE_TIMEOUT_MIN) || 30) * 60_000;

/**
 * Bare clone with nothing from the repository able to run: no template hooks, no submodules, https only, a time limit.
 * It clones beside the target and renames when complete, so an interrupted clone is never mistaken for a finished one.
 * `extraConfig` ("key=value") is for tests.
 */
export async function cloneSafely(source: string, dir: string, onProgress?: ProgressFn, extraConfig: string[] = []): Promise<void> {
  const tmp = `${dir}.partial`;
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await fs.rm(tmp, { recursive: true, force: true });
  try {
    await withTimeout(cloneTimeoutMs(), `cloning ${source}`, () =>
      runWithProgress(["clone", "--bare", "--template=", "--no-recurse-submodules", "--progress", source, tmp], undefined, "clone", onProgress, extraConfig),
    );
  } catch (e) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw e;
  }
  await fs.rename(tmp, dir);
}

/** Clones on first use. An existing clone is only fetched when `fetch` is true (user pressed Refresh). */
async function syncClone(t: Target, fetch: boolean, onProgress?: ProgressFn): Promise<string> {
  if (t.local) return t.source;
  const dir = path.join(CACHE_DIR, "repos", `${t.slug}.git`);
  if (await exists(dir)) {
    if (fetch) {
      onProgress?.({ stage: "fetch", pct: null, message: "Checking for new commits" });
      await withTimeout(cloneTimeoutMs(), `fetching ${t.repo}`, () =>
        runWithProgress(["fetch", "--prune", "--no-recurse-submodules", "--progress", "origin", "+refs/heads/*:refs/heads/*"], dir, "fetch", onProgress),
      );
    }
  } else {
    onProgress?.({ stage: "clone", pct: 0, message: "Cloning repository" });
    await fs.mkdir(path.dirname(dir), { recursive: true });
    await cloneSafely(t.source, dir, onProgress);
  }
  return dir;
}

/** Streams a git command's stdout line by line. */
function streamLines(args: string[], cwd: string, onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawnGit(args, cwd);
    let rest = "";
    let err = "";
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d: string) => {
      const lines = (rest + d).split("\n");
      rest = lines.pop() ?? "";
      for (const l of lines) onLine(l);
    });
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (rest) onLine(rest);
      if (code === 0) resolve();
      else reject(new Error(`git ${args[0]} failed: ${err.trim().slice(0, 300)}`));
    });
  });
}

async function readLog(gitDir: string, ref: string, overrides: AgentOverrides, isVendored: (f: string) => boolean, onProgress?: ProgressFn) {
  let branch = "HEAD";
  try {
    branch = (await run(["rev-parse", "--abbrev-ref", "HEAD"], gitDir)).trim();
  } catch {}

  let total = 0;
  try {
    total = Number((await run(["rev-list", "--count", "--no-merges", ref], gitDir)).trim()) || 0;
  } catch {}

  const authors: string[] = [];
  const botAuthors: number[] = [];
  const aiAuthors: number[] = [];
  const authorIdx = new Map<string, number>();
  const agents: string[] = [];
  const agentIdx = new Map<string, number>();
  const commits: CommitRow[] = [];
  const bulk: BulkCommit[] = [];
  const coauthors = new Map<string, number>();
  const agentId = (label: string) => {
    let i = agentIdx.get(label);
    if (i === undefined) agentIdx.set(label, (i = agents.push(label) - 1));
    return i;
  };

  let cur: CommitRow | null = null;
  let curHash = "";
  let curSubject = "";
  let lastReport = 0;

  /** Called when a commit's file lines are complete: flag bulk commits. */
  const finish = () => {
    if (cur && cur.add + cur.del > BULK_COMMIT_LINES) {
      cur.b = 1;
      bulk.push({ h: curHash, t: cur.t, a: cur.a, lines: cur.add + cur.del, s: curSubject.slice(0, 90) });
    }
  };

  const onLine = (line: string) => {
    if (line.startsWith("@@")) {
      finish();
      const parts = line.slice(2).split("\t");
      const ts = parts[0];
      const name = parts[1] || "unknown";
      const email = parts[2] ?? "";
      curHash = parts[3] ?? "";
      curSubject = parts.slice(4, -1).join("\t");
      const trailers = parts.length > 5 ? parts[parts.length - 1] : "";

      const key = identityKey(name, email);
      let idx = authorIdx.get(key);
      if (idx === undefined) {
        idx = authors.push(name) - 1;
        authorIdx.set(key, idx);
        const k = classifyIdentity(name, email, overrides)?.kind;
        if (k === "bot") botAuthors.push(idx);
        else if (k === "ai") aiAuthors.push(idx);
      }

      const own = classifyIdentity(name, email, overrides);
      const ai = new Set<number>();
      if (own?.kind === "ai") ai.add(agentId(own.label));
      for (const co of trailers.split("\x1f")) {
        if (!co.trim()) continue;
        const m = co.match(/^(.*?)\s*<([^>]*)>/);
        const coName = (m ? m[1] : co).trim();
        const id = classifyIdentity(coName, m ? m[2] : "", overrides);
        if (id?.kind === "ai") ai.add(agentId(id.label));
        else if (!id && coName) coauthors.set(coName, (coauthors.get(coName) ?? 0) + 1);
      }

      cur = { t: Number(ts), a: idx, add: 0, del: 0, ag: [...ai] };
      if (own?.kind === "bot") cur.bot = 1;
      if (isHousekeeping(curSubject)) cur.x = 1;
      if (/\(#\d+\)\s*$/.test(curSubject)) cur.sq = 1;
      commits.push(cur);

      const now = Date.now();
      if (onProgress && now - lastReport > 120) {
        lastReport = now;
        onProgress({
          stage: "commits",
          pct: total ? Math.min(99, Math.round((commits.length / total) * 100)) : null,
          message: `Reading commits (${commits.length.toLocaleString("en")}${total ? ` of ${total.toLocaleString("en")}` : ""})`,
        });
      }
    } else if (cur && line) {
      const [a, d, file] = line.split("\t");
      if (a === "-" || !file || isIgnoredPath(file) || isVendored(file)) return;
      const added = Number(a);
      const deleted = Number(d);
      if (isBulkDataFile(file, added + deleted)) return;
      cur.add += added;
      cur.del += deleted;
    }
  };

  await streamLines(
    [
      "log", ref, "--no-merges", "--numstat", "--no-renames",
      "--format=@@%at%x09%aN%x09%aE%x09%h%x09%s%x09%(trailers:key=Co-Authored-By,valueonly,unfold,separator=%x1f)",
    ],
    gitDir,
    onLine,
  );
  finish();
  commits.sort((x, y) => x.t - y.t);
  bulk.sort((x, y) => y.lines - x.lines);

  const unrecognized = [...coauthors.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 30)
    .map(([name, count]) => ({ name, count }));

  return { branch, authors, botAuthors, aiAuthors, agents, commits, bulk: bulk.slice(0, 30), unrecognized };
}

/**
 * Code size from the tree, not from adding up diffs: at the end of each month, count the lines
 * in the tree (same exclusions as the commit stats). Each step is one `git diff --numstat --no-renames` between
 * two month-end trees. Renames are NOT detected on purpose: a moved file is then a delete of the old path plus an add of the new
 * one, each judged on its own path, so a file moved into or out of an excluded folder (vendored, tests, docs) is counted
 * correctly. With rename detection such a move showed as zero change and left the old copy counted forever.
 */
async function readSnapshots(gitDir: string, ref: string, commits: CommitRow[], isVendored: (f: string) => boolean, onProgress?: ProgressFn): Promise<Analysis["snapshots"]> {
  if (!commits.length) return [];
  const first = commits[0].t;
  const last = commits[commits.length - 1].t;

  const roots = (await run(["rev-list", "--max-parents=0", ref], gitDir)).trim().split(/\r?\n/).filter(Boolean);
  const root = roots[roots.length - 1];

  const boundaries: number[] = [];
  const d0 = new Date(first * 1000);
  for (let m = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1); m / 1000 <= last; ) {
    boundaries.push(m / 1000);
    const d = new Date(m);
    m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }

  const points: { t: number; sha: string }[] = [];
  for (const b of boundaries) {
    const sha = (await run(["rev-list", "-1", "--first-parent", `--before=${b}`, ref], gitDir)).trim();
    if (sha) points.push({ t: b - 1, sha });
  }
  points.push({ t: last, sha: (await run(["rev-parse", ref], gitDir)).trim() });

  // net lines per file category (source code, tests, docs, data, other) for one diff
  const netOf = (numstat: string): Breakdown => {
    const net = emptyBreakdown();
    for (const line of numstat.split("\n")) {
      if (!line) continue;
      const [a, d, rawPath] = line.split("\t");
      if (a === "-" || !rawPath) continue;
      const file = newPathOf(rawPath);
      if (isIgnoredPath(file) || isVendored(file)) continue;
      const added = Number(a);
      const deleted = Number(d);
      if (isBulkDataFile(file, added + deleted)) continue;
      net[categorize(file)] += added - deleted;
    }
    return net;
  };
  const addTo = (total: Breakdown, delta: Breakdown) => {
    for (const k of CATEGORIES) total[k] += delta[k];
  };

  // baseline: everything the root commit contributes (it has no parent to diff against)
  const total = netOf(await run(["diff-tree", "--root", "--numstat", "-r", "--no-commit-id", root], gitDir));
  let prev = root;
  const out: Analysis["snapshots"] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.sha !== prev) {
      addTo(total, netOf(await run(["diff", "--numstat", "--no-renames", prev, p.sha], gitDir)));
      prev = p.sha;
    }
    // loc = source code only (no tests, docs or data); the others are reported beside it
    out.push({ t: p.t, loc: total.source, tests: total.tests, docs: total.docs, data: total.data, other: total.other });
    onProgress?.({ stage: "snapshots", pct: Math.round(((i + 1) / points.length) * 100), message: `Measuring code size (${i + 1} of ${points.length} snapshots)` });
  }
  return out;
}

type OtherTags = NonNullable<Analysis["otherTags"]>;

async function readReleases(
  gitDir: string,
  rules: ReleaseRules | undefined,
  /** when pinned to a commit, only tags reachable from it count */
  mergedInto?: string,
): Promise<{ releases: ReleaseRow[]; packageTags: number; releaseStyle: ReleaseStyle; otherTags: OtherTags }> {
  const out = await run(["for-each-ref", "refs/tags", ...(mergedInto ? ["--merged", mergedInto] : []), "--format=%(refname:short)%09%(creatordate:unix)"], gitDir);
  const tags = out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [name, t] = l.split("\t");
      return { name, t: Number(t) };
    })
    .filter((r) => r.t > 0);

  const promoted = mainLinePrefix(tags.map((r) => r.name), rules);
  let packageTags = 0;
  const otherTags: OtherTags = { package: [], ignored: [], other: [], duplicate: [] };
  const rows: ReleaseRow[] = [];
  for (const r of tags) {
    let kind = classifyTag(r.name, rules);
    if (kind === "package") {
      if (promoted !== null && r.name.startsWith(promoted)) kind = "stable";
      else {
        packageTags++;
        otherTags.package.push(r.t);
      }
    } else if (kind === "ignored") otherTags.ignored.push(r.t);
    else if (kind === "other") otherTags.other.push(r.t);
    // package, ignored and non-version tags are not releases of the project
    if (kind === "stable") rows.push({ name: r.name, t: r.t, pre: false, stable: true, rolling: false });
    else if (kind === "pre") rows.push({ name: r.name, t: r.t, pre: true, stable: false, rolling: false });
    else if (kind === "rolling") rows.push({ name: r.name, t: r.t, pre: false, stable: false, rolling: true });
  }

  // the same version tagged twice (v1.2.3 and v1.2.3-stable) is one release: keep the earliest tag
  const firstByKey = new Map<string, ReleaseRow>();
  for (const r of rows.filter((x) => x.stable).sort((a, b) => a.t - b.t)) {
    const key = releaseKey(r.name);
    if (!firstByKey.has(key)) firstByKey.set(key, r);
  }
  const keep = new Set(firstByKey.values());
  for (const r of rows) if (r.stable && !keep.has(r)) otherTags.duplicate.push(r.t);
  const releases = rows.filter((r) => !r.stable || keep.has(r)).sort((a, b) => a.t - b.t);

  const style = releaseStyle(
    releases.filter((r) => r.stable).map((r) => r.name),
    releases.filter((r) => r.rolling).length,
  );
  return { releases, packageTags, releaseStyle: style, otherTags };
}

/** Merge commits are left out of the commit stats; their timestamps show how the project merges (merge commits vs squash). */
async function readMergeTimes(gitDir: string, ref: string): Promise<number[]> {
  const out = await run(["log", ref, "--merges", "--format=%at"], gitDir);
  return out.split("\n").filter(Boolean).map(Number).sort((a, b) => a - b);
}

async function readAgentFiles(gitDir: string, ref: string): Promise<{ tool: string; path: string; files: number; addedAt: number | null }[]> {
  const names = (await run(["ls-tree", "-r", "--name-only", ref], gitDir)).split("\n").filter(Boolean);
  const byTool = new Map<string, string[]>();
  for (const n of names) {
    const tool = agentFileTool(n);
    if (tool) byTool.set(tool, [...(byTool.get(tool) ?? []), n]);
  }
  const out: { tool: string; path: string; files: number; addedAt: number | null }[] = [];
  for (const [tool, files] of byTool) {
    // when did the first such file appear? one log call per tool, on the shortest (most top-level) path
    const first = [...files].sort((a, b) => a.length - b.length)[0];
    let addedAt: number | null = null;
    try {
      const log = (await run(["log", ref, "--diff-filter=A", "--format=%at", "--", first], gitDir)).split("\n").filter(Boolean).map(Number);
      addedAt = log.length ? Math.min(...log) : null;
    } catch {}
    out.push({ tool, path: first, files: files.length, addedAt });
  }
  return out.sort((a, b) => (a.addedAt ?? Infinity) - (b.addedAt ?? Infinity));
}

async function readCached(file: string): Promise<{ schema: number; data: Analysis } | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

const hashOf = (x: unknown) => createHash("sha1").update(JSON.stringify(x ?? null)).digest("hex").slice(0, 8);

/**
 * What a cached analysis must match to still be valid for a repository, without reading anything but the two rule files.
 * `ga sample` uses it to decide whether a repository is already done for the month.
 */
export async function currentRules(input: string): Promise<{ schema: number; classifier: string; releaseRulesId: string; vendoredId: string }> {
  const t = await resolveTarget(input);
  const r = await resolveRules(t.repo);
  return { schema: SCHEMA, classifier: r.classifier, releaseRulesId: r.releaseRulesId, vendoredId: r.vendoredId };
}

/** Everything the rule files say about one repository, as the ids that decide whether a cached analysis is still valid. */
async function resolveRules(repo: string) {
  const repoRules = await loadRepoRules(repo);
  const overrides = mergeAgentOverrides(await loadOverrides(), repoRules?.agents);
  const release = repoRules && Object.fromEntries(Object.entries(repoRules).filter(([k]) => k !== "vendored" && k !== "agents"));
  const releaseRules = release && Object.keys(release).length ? (release as ReleaseRules) : undefined;
  const vendored = repoRules?.vendored ?? [];
  return {
    overrides,
    classifier: classifierId(overrides),
    releaseRules,
    releaseRulesId: hashOf(releaseRules),
    vendored,
    /** empty when the repository has no vendored paths, so analyses made before this rule existed stay valid */
    vendoredId: vendored.length ? hashOf(vendored) : "",
    applied: { release: releaseRules ?? null, vendored, agents: repoRules?.agents ?? null },
  };
}

/** The local bare clone (or local repository) for an analysis, or null if it is not on disk. */
export async function gitDirFor(data: Pick<Analysis, "source" | "repo">): Promise<string | null> {
  const t = await resolveTarget(data.source.startsWith("https://github.com/") ? data.repo : data.source);
  const dir = t.local ? t.source : path.join(CACHE_DIR, "repos", `${t.slug}.git`);
  return (await exists(dir)) ? dir : null;
}

/** Last commit at or before a moment (by commit date, which can differ from author date on rebased history). */
export async function headAtOrBefore(gitDir: string, asOf: number, ref = "HEAD"): Promise<{ sha: string; committedAt: number } | null> {
  const sha = (await run(["rev-list", "-1", `--before=${Math.floor(asOf) + 1}`, ref], gitDir)).trim();
  if (!sha) return null;
  return { sha, committedAt: Number((await run(["log", "-1", "--format=%ct", sha], gitDir)).trim()) };
}

export interface AnalyzeOptions {
  /** analyse this commit instead of the branch head (full or abbreviated sha); the result is cached separately */
  pin?: string;
}

export async function analyze(input: string, refresh = false, onProgress?: ProgressFn, opts: AnalyzeOptions = {}): Promise<Analysis> {
  const t = await resolveTarget(input);
  const pin = opts.pin?.trim() || undefined;
  if (pin && !/^[0-9a-f]{7,40}$/i.test(pin)) throw new Error(`--pin must be a commit sha (7-40 hex characters), got "${pin}"`);
  const cacheName = pin ? `${t.slug}@${pin.toLowerCase().slice(0, 12)}` : t.slug;
  const cacheFile = path.join(CACHE_DIR, "analysis", `${cacheName}.json`);
  const { overrides, classifier, releaseRules: rules, releaseRulesId: rulesId, vendored, vendoredId, applied } = await resolveRules(t.repo);
  const isVendored = globMatcher(vendored);
  const cloneDir = path.join(CACHE_DIR, "repos", `${t.slug}.git`);

  if (!refresh && !t.local) {
    const cached = await readCached(cacheFile);
    if (cached?.schema === SCHEMA && cached.data.classifier === classifier && (cached.data.vendoredId ?? "") === vendoredId) {
      const complete = !!cached.data.headSha && !!cached.data.otherTags;
      if (cached.data.releaseRulesId === rulesId && complete) {
        onProgress?.({ stage: "cache", pct: 100, message: "Loaded from cache" });
        return cached.data;
      }
      // only the release rules changed, or the entry predates headSha / tag counts: re-read the tags (and head) from the
      // local clone, not the history, and no network
      if (await exists(cloneDir)) {
        onProgress?.({ stage: "tags", pct: null, message: "Re-reading release tags" });
        const ref = pin ?? "HEAD";
        const re = await readReleases(cloneDir, rules, pin ? ref : undefined);
        const headSha = cached.data.headSha ?? (await run(["rev-parse", `${ref}^{commit}`], cloneDir)).trim();
        const data = { ...cached.data, ...re, releaseRulesId: rulesId, headSha, pinned: !!pin, vendoredId, appliedRules: applied };
        await fs.writeFile(cacheFile, JSON.stringify({ schema: SCHEMA, data }));
        return data;
      }
    }
  }

  // An existing clone is reused without touching the network unless the user pressed Refresh.
  const gitDir = await syncClone(t, refresh, onProgress);
  let ref = "HEAD";
  if (pin) {
    try {
      ref = (await run(["rev-parse", "--verify", `${pin}^{commit}`], gitDir)).trim();
    } catch {
      throw new Error(`--pin ${pin} is not a commit in ${t.repo}${t.local ? "" : " (try --refresh to fetch newer commits)"}`);
    }
  }
  const headSha = (await run(["rev-parse", `${ref}^{commit}`], gitDir)).trim();
  const log = await readLog(gitDir, ref, overrides, isVendored, onProgress);
  onProgress?.({ stage: "snapshots", pct: 0, message: "Measuring code size" });
  const snapshots = await readSnapshots(gitDir, ref, log.commits, isVendored, onProgress);
  onProgress?.({ stage: "tags", pct: null, message: "Reading release tags" });
  const { releases, packageTags, releaseStyle: style, otherTags } = await readReleases(gitDir, rules, pin ? ref : undefined);
  const [mergeTimes, agentFiles] = await Promise.all([readMergeTimes(gitDir, ref), readAgentFiles(gitDir, ref)]);

  const data: Analysis = {
    repo: t.repo,
    source: t.source,
    branch: log.branch,
    fetchedAt: Date.now(),
    classifier,
    releaseRulesId: rulesId,
    vendoredId,
    appliedRules: applied,
    bulkLines: BULK_COMMIT_LINES,
    snapshots,
    authors: log.authors,
    botAuthors: log.botAuthors,
    aiAuthors: log.aiAuthors,
    agents: log.agents,
    commits: log.commits,
    releases,
    releaseStyle: style,
    packageTags,
    otherTags,
    headSha,
    pinned: !!pin,
    mergeTimes,
    agentFiles,
    bulk: log.bulk,
    unrecognized: log.unrecognized,
  };

  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify({ schema: SCHEMA, data }));
  return data;
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Which directories changed most in source code between two moments (net lines, source-language files only; same file
 * exclusions as the code-size measure). Used to explain a large quarterly change: the top entry is usually the vendored or generated
 * folder that came or went. `from`/`to` are unix seconds; commits are picked by commit date, like the month-end snapshots.
 */
export async function changedDirectories(gitDir: string, ref: string, from: number, to: number, top = 5, isVendored: (f: string) => boolean = () => false): Promise<{ path: string; netSourceLines: number }[]> {
  const shaAt = async (t: number) => (await run(["rev-list", "-1", "--first-parent", `--before=${t}`, ref], gitDir)).trim();
  const [a, b] = [await shaAt(from), await shaAt(to)];
  if (!b || a === b) return [];
  const out = a ? await run(["diff", "--numstat", "--no-renames", a, b], gitDir) : await run(["diff", "--numstat", "--no-renames", EMPTY_TREE, b], gitDir);
  const byDir = new Map<string, number>();
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [add, del, rawPath] = line.split("\t");
    if (add === "-" || !rawPath) continue;
    const file = newPathOf(rawPath);
    if (isIgnoredPath(file) || isVendored(file) || categorize(file) !== "source") continue;
    const added = Number(add);
    const deleted = Number(del);
    if (isBulkDataFile(file, added + deleted)) continue;
    const parts = file.split("/");
    const dir = parts.length <= 1 ? "(root)" : parts.slice(0, Math.min(2, parts.length - 1)).join("/");
    byDir.set(dir, (byDir.get(dir) ?? 0) + added - deleted);
  }
  return [...byDir.entries()]
    .filter(([, n]) => n !== 0)
    .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
    .slice(0, top)
    .map(([p, n]) => ({ path: p, netSourceLines: n }));
}
