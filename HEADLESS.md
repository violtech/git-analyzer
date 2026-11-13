# Git Analytics without the UI

Everything the web dashboard does is available without a browser. The dashboard, the CLI and the REST API call the same
code (`lib/view.ts` builds every number), so an agent reads the same figures a person sees on screen.

Run from the project root, or from any folder with absolute paths: `npm run ga -- <command>`.
Output is JSON on stdout. Progress (`--progress`) and errors go to stderr. Exit code: 0 ok, 1 error, 2 GitHub rate limit,
3 (`sample` only) some repositories failed.
`npm run ga -- describe` prints the commands, flags and report sections as JSON.

## Dashboard action → headless equivalent

| In the UI | CLI | REST (dev server on :3100) |
|---|---|---|
| Home: explore repositories | `ga explore --period all --topic rust --language Go --sort stars --page 1` | `GET /api/explore?period=&topic=&language=&sort=&page=` |
| Analyze a repo (progress bar) | `ga analyze <repo> --progress` | `GET /api/analyze/stream?repo=` (NDJSON progress, then result) |
| Refresh | add `--refresh` | add `&refresh=1` |
| Every dashboard tab, with period / range / kind / large-commit toggles | `ga report <repo> --period month --range all --kind all [--exclude-bulk] [--as-of 2026-10-30] [--pin SHA] [--quarters 4] [--releasing-days 180] [--active-days 90] --sections a,b` | `GET /api/report?repo=&period=&range=&kind=&excludeBulk=1&asOf=&pin=&quarters=&sections=` |
| Pull requests tab (12 months / full history) | `ga report <repo> --pulls [--pulls-full]` or `ga pulls <owner/repo> [--full]` | `GET /api/report?...&pulls=1[&pullsFull=1]` or `GET /api/pulls?repo=[&full=1]` |
| API budget badge | `ga budget` | `GET /api/github-budget` |
| Edit `agents.config.json` | `ga agents list` / `add <ai\|bot\|human> <name>` / `remove ...` | not exposed (a local web page could otherwise rewrite it) |
| (no UI) Monthly sample | `ga sample [--list samples/example.json] [--out snapshots] [--as-of 2026-10-31] [--timeout-min 30]` or `npm run sample` | not exposed (long-running, writes files) |

`<repo>` is a GitHub URL, `owner/name`, or a path to a local git repository.

## Report sections (`--sections`, default: all but `heatmap`)

`summary`, `timeline`, `velocity`, `releases`, `intervals`, `pulls`, `people`, `ai`, `detection`, `bulk`, `pulse`, `stability`, `quarters`, `mergeStyle`, `heatmap`

| Dashboard tab | Sections |
|---|---|
| stat cards | `summary` |
| Overview | `timeline`, `bulk`, `pulse` |
| Velocity | `velocity`, `timeline`, `heatmap`, `mergeStyle` |
| Releases | `releases`, `stability`, `quarters` |
| Between releases | `intervals` |
| Pull requests | `pulls` |
| People | `people`, `ai` (incl. agent instruction files), `detection` |

Every report starts with `meta`: repo, branch, analysis time, the parameters used, the classifier version, `releaseStyle`, `tagCounts`,
`provenance` and `notes`.
Read the notes: they state that the AI share is a lower bound and whether large commits were left out of the added/deleted stats.
`--as-of 2026-10-30` reproduces a report: it means the end of that day (UTC), and everything later is ignored (commits, tags, merges,
instruction files, pull requests). Code size is then the latest month-end snapshot at or before that moment.

## Reproducing a report: `meta.provenance` and `--pin`

`meta.provenance` records what produced the numbers: `toolVersion`, `classifier` (rules version + hash of `agents.config.json`),
`releaseRulesId` (hash of the repository's `release-rules.json` entry), `analysisSchema`, `asOf`, `analysedSha` (the commit that was
read), `pinned`, and `headAtAsOf` (the last commit at or before `asOf`, by commit date, with its date). The same `asOf`, the same analysed
commit and the same rule files give the same numbers. **Rewritten history (force pushes, rebased branches), a different rule file or a
different tool version can still change results**, so compare `provenance` before comparing numbers.

`--pin <sha>` analyses that commit instead of the branch head: later commits are not read and only tags reachable from it count. A pinned
analysis is cached separately and its sha is in `provenance.analysedSha` with `pinned: true`. Combine it with `--as-of` to ask what that
commit looked like on a date. An unknown sha fails with a clear message (try `--refresh` to fetch newer commits). `headAtAsOf` is found
with the clone on disk; without it the field is `null` and the rest of the report is unchanged.

## Tag counts and release style: `meta.tagCounts`

`tagCounts` says what the repository's tags turned out to be, so "no releases" can be told from "a tag style we do not recognise":
`stable`, `pre`, `rolling` (counted as releases or builds), and the rest by reason: `package` (monorepo tags such as `@scope/pkg@1.2.3`),
`ignored` (excluded by a rule), `other` (not a version, e.g. `latest`), `duplicates` (same version tagged twice), plus `total`. All counts
respect `--as-of`. `meta.releaseStyle` is `semver`, `calendar`, `rolling-builds` or `none`. A repository with many tags but `stable: 0` and
a large `other`, `ignored` or `package` count has a tag style that needs a rule in `release-rules.json`.

## Project status (`pulse`)

`pulse.status` is one of, in this order of precedence:

- `releasing`: a stable release (for rolling-build projects, a build) within `--releasing-days` (default 180). Pre-releases do not count.
- `developing`: no such release, but a human commit within `--active-days` (default 90). Bot commits do not count.
- `quiet`: neither.

Also in `pulse`: `lastCommit`, `lastRelease`, `lastReleaseKind` (`stable` or `rolling-build`) and the `thresholds` used. It works for
repositories with no releases (they are `developing` or `quiet`). A last commit between 90 and 180 days ago with no release is `quiet`.
`ga sample` copies the status into the index (`projectStatus`).

## Quarters (`quarters`)

`ga report <repo> --sections quarters [--quarters 4] [--as-of 2026-10-30]` returns one row per calendar quarter (UTC month boundaries; Q1 =
Jan-Mar), oldest first, ending with the quarter that contains `--as-of`. The section carries its own `definition` text. Per quarter:

| Field | Meaning |
|---|---|
| `complete` | `false` for the quarter still running at `asOf` |
| `stableReleases`, `releases` | stable releases tagged in the quarter, and their names |
| `medianDaysBetweenReleases` | median gap between consecutive stable releases where the later one falls in the quarter (the earlier one may be older) |
| `waitAtQuarterEndDays` | only when there was no stable release: days since the previous one at quarter end (or at `asOf`) |
| `rollingBuilds` | continuous builds (`b1234`) tagged in the quarter, never mixed into releases |
| `sourceLinesStart`, `sourceLinesEnd` | source-code lines in the tree before the quarter and at its end (month-end snapshots; tests, docs, data excluded) |
| `netSourceChange`, `growthPct` | end minus start, and that as a percentage of the start. **This is the one definition of growth.** |
| `sourceLinesStartMeasuredAt`, `sourceLinesEndMeasuredAt` | the snapshot dates used; the running quarter's end can lag by up to a month |
| `commitLinesAddedAllFileTypes` | gross lines added by the quarter's commits across **all** file types (source, tests, docs, data). Activity, not growth: do not compare it with `netSourceChange` |
| `largeChange`, `topChangedDirectories` | `largeChange` is set when the net change is at least 20% of the start size and at least 5,000 lines; for those quarters `topChangedDirectories` lists the directories (two levels) with the biggest net source change, e.g. a vendored copy that was removed |

A large negative `netSourceChange` with a vendored or generated directory at the top of `topChangedDirectories` is not a rewrite: footnote
it, or add a vendored-path rule once per-repository rules exist. The directory hint needs the clone on disk; otherwise it stays `null`.

## Things to know before quoting a number

- **AI share is a lower bound.** Detection is a strict allowlist plus `agents.config.json`; squash merges can drop `Co-Authored-By` trailers.
  Check `detection` (identities per year, and co-author names that matched no rule) before publishing a share. The share excludes
  bots and reverts / version bumps. `ai.instructionFiles` lists agent instruction files in the current tree (exact, case-sensitive names:
  AGENTS.md, CLAUDE.md, GEMINI.md, `.cursor/rules/`, `.github/copilot-instructions.md`, ...) and when each first appeared. Files inside
  docs, templates, examples, tests or vendored folders do not count: a docs page named agents.md, or a CLAUDE.md template a project ships to
  its users, is not the project's own setup.
- **Code size is measured**, not summed, and counts source code only: lines in source-language files in the tree at the end of each
  month (`codeLines`). Tests, docs (anything under `docs/`, plus .md/.mdx/.rst), data/config and other files are reported beside it in
  `codeBreakdown`, so a documentation tree that is copied for every release cannot inflate growth. Squashing, renames and vendored code
  that comes and goes do not distort it. `linesAdded`/`linesDeleted` are summed from commits and count every non-ignored text file. Commits over 5,000 counted lines are listed in `bulk`; many are real squash-merged features, so they are **not**
  excluded by default. `--exclude-bulk` leaves them out of added/deleted stats only.
- **Releases** are main-line version tags, with the same version tagged twice (`v1.2.3`, `v1.2.3-stable`) counted once.
  Monorepo package tags (`@scope/pkg@1.2.3`) are ignored (`packageTagsIgnored`). Continuous build numbers (`b1234`) are
  `rolling` builds, not releases: `releases.style` is `rolling-builds` and cadence is reported as builds. Repositories whose tags
  the defaults get wrong are fixed in `release-rules.json` (see below).
- **Commits per release** (`stability.commitsPerRelease`) excludes bots, reverts and version bumps. Generated SDKs ship their code in bot
  commits, so read `commitsPerRelease.includingBots` for them.
- **Merge style**: `mergeStyle` shows the squash-merge share and merge commits per year. A switch to squash merging cuts the commit
  count by itself, so a drop in commits is not automatically a slowdown.
- **Contributors** are distinct non-bot author identities, merged by email, everywhere (summary, table and bus factor).

## Per-repository rules (`release-rules.json`) and where rule files live

One entry per repository, keyed by `owner/name` (any case). Everything the tool needs to know about one repository is in that entry:

```json
{
  "n8n-io/n8n": {
    "mainPackage": "n8n@",
    "stable": [], "pre": [], "rolling": [], "ignore": [],
    "vendored": ["packages/vendor-copy/", "third_party/**/*.c"],
    "agents": { "ai": ["Some Pilot"], "bot": [], "human": [] }
  }
}
```

- **Tag rules.** `stable`, `pre`, `rolling` and `ignore` are regular expressions tested against tag names (case-insensitive) and always win.
  `mainPackage` names the project's own package for repositories whose tags carry the package name: the tag text before the version, such
  as `n8n@`, `@upstash/context7-sdk@` or `python-v`. Tags that start with it are the project's releases (`n8n@2.45.7` is stable,
  `n8n@2.45.7-beta.1` a pre-release); every other versioned tag is counted as another package (`tagCounts.package`), and a plain
  `v1.2.3` tag in that repository is another package too. Another package is never promoted to the release line when `mainPackage` is set.
- **`vendored`.** Root-relative path patterns left out of code size, the quarterly figures and lines added (and the directory hint).
  `dir/` covers a folder and everything under it, `*` stays inside one folder level, `**` crosses levels, `?` is one character. Use it for
  a vendored copy of another project, not to hide real work. The report lists what was applied in `meta.rulesApplied`.
- **`agents`.** Names that count as AI, bot or human in this repository only. Global names (below) keep working everywhere.

Rules ship in the project root for `langchain-ai/langchain`, `openai/codex` and `ggml-org/llama.cpp` (generic, public repositories);
`BerriAI/litellm` needs none. **Your own rules do not have to live in this repository:**

| Flag (all of `analyze`, `report`, `sample`) | Environment variable | Meaning |
|---|---|---|
| `--rules-dir DIR` | `GIT_ANALYTICS_RULES_DIR` | folder with `release-rules.json` and/or `agents.config.json`. An entry there replaces the shipped entry for the same repository; other shipped rules still apply |
| `--agents-config FILE` | `GIT_ANALYTICS_AGENTS_CONFIG` | one file of global agent names (`{"ai": [...], "bot": [...], "human": [...]}`); wins over the folder's `agents.config.json` |
| `--clone-timeout-min N` | `GIT_ANALYTICS_CLONE_TIMEOUT_MIN` | minutes a clone or fetch may take (default 30) |

The REST API reads the environment variables. The shipped `agents.config.json` is empty.

What a rule change costs (cached analyses are kept in `.cache/analysis`, one per repository, and re-used when the rules still match):

- Changing **tag rules or `mainPackage`** re-reads the tags from the local clone: seconds, no network, history not re-read.
- Changing **`vendored` or `agents`** (or the global agent list) means the commit history and month-end sizes are read again from the local
  clone: minutes for a large repository, no network. Only repositories whose own entry changed are affected by `vendored`/`agents`; a
  change to the global list affects every cached repository once.
- Analyses made before these rules existed stay valid for repositories without a `vendored` entry.
- The cache holds one analysis per repository, so alternating between two different agent lists re-reads the history each time; keep one.

## Safe cloning

Git is only used to read history, and nothing from a repository is ever run. Every git call carries the same settings: hooks off
(`core.hooksPath=/dev/null`), no filesystem monitor, no submodule recursion, only `https` remotes allowed, no password prompts. A clone
uses an empty template (no hooks), skips submodules, has a time limit (`--clone-timeout-min`, default 30) and is made into a
`.partial` folder that is renamed only when complete, so a stopped clone is cleaned up and never mistaken for a finished one.
Local repositories are read in place with the same settings.

## Monthly sample (`ga sample`)

Runs the analysis for every repository in `samples/example.json` and writes `snapshots/YYYY-MM/<owner>__<name>.json`
(stars and repo facts from the GitHub API, plus the report) and `snapshots/YYYY-MM/index.json` (one row per repository, with
`aiShareAllTimePct`, `aiShareLast12MonthsPct`, `aiSharePrev12MonthsPct` (all lower bounds), source `codeLines`, `agentInstructionTools`,
`projectStatus` and stars). `--as-of 2026-10-31` measures the repositories as they stood then and files the snapshot under that month, so
a month can be reproduced later. It is run by hand; nothing schedules it. Stars cost one API request per
repository (cached 12 hours); GitHub requests are made one at a time.

**It can be stopped and started again.** A repository is *complete* when its snapshot file exists for that month and `asOf`, was made with
the same cache schema, classifier (`agents.config.json`) and release rules, contains the requested sections and, unless `--no-info`, has
its stars. A second run skips complete repositories (`status: "skipped"`), redoes the rest and keeps going if one fails: a repository that
errors or exceeds `--timeout-min` (default 30) is listed under `summary.failed` with the reason and never stops the run. Snapshot files
are written to a temporary name and renamed, so a killed run leaves no half-written file that looks finished, and `index.json` is rewritten
after every repository (`complete: false` until the run ends). `--refresh` redoes everything. If the GitHub budget runs out, analysis
continues and `rateLimited` is `true`; run again later to fill in the missing stars. Snapshots written by earlier versions have no rules
key, so the first run with this version redoes them once (from the local cache; no re-clone).

The result has `summary` (`succeeded`, `skipped`, `failed` with reasons) and one row per repository. Exit code: 0 all ok, 3 some repositories
failed (1 if all failed), 2 GitHub rate limit left stars missing, 1 usage error.

A larger list needs a read-only `GITHUB_TOKEN` set in your environment; the app never stores one.
`--no-info` skips the GitHub API entirely.

## GitHub API budget

Only `explore`, pull request stats and `sample` stars use the GitHub API. Cloning and reading history do not. All API calls go through
`lib/github-client.ts`: responses are cached on disk (`.cache/http`), revalidated with ETags (a 304 costs nothing), stop
before the limit is reached, and serve an older copy rather than fail. Without a token: 60 requests/hour, 10 searches/minute.
Set `GITHUB_TOKEN` to raise that. A rate-limit stop exits 2 with `{"code":"RATE_LIMIT","resetAt":"..."}` on stderr.
Pull requests default to the last 12 months (about 10 requests); `--pulls-full` is the expensive option.

## Files

- `.cache/repos/*.git` bare clones, `.cache/analysis/*.json` parsed history, `.cache/http/` API responses. Safe to delete.
- `agents.config.json` exact names for `ai`, `bot`, `human` (empty as shipped; or `--agents-config` / `--rules-dir`). Changing it re-classifies cached analyses on next use, without network.
- `release-rules.json` per-repository tag rules (above). `samples/` the saved list for `ga sample`. `snapshots/` its output.
- Tests: `npm test` (fixtures from the published review: tag shapes from real repositories, false-positive agent names, snapshot size, stability, CLI contract).
