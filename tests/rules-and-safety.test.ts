import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildFullReport } from "../lib/full-report";
import { cloneSafely, analyze, currentRules, SAFE_GIT_ARGS, withTimeout } from "../lib/git";
import { globMatcher } from "../lib/glob";
import { loadOverrides, loadRepoRules, mergeAgentOverrides } from "../lib/overrides";
import { parseAsOf } from "../lib/report";
import { classifyTag, mainLinePrefix } from "../lib/tags";

const ENV_KEYS = ["GIT_ANALYTICS_RULES_DIR", "GIT_ANALYTICS_AGENTS_CONFIG"] as const;
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("globMatcher (vendored path patterns)", () => {
  const m = globMatcher(["llama/llama.cpp/", "third_party/**/*.c", "docs/api?.md", "*.gen.ts"]);
  it("matches a folder and everything under it", () => {
    expect(m("llama/llama.cpp/ggml.c")).toBe(true);
    expect(m("llama/llama.cpp/src/deep/x.cpp")).toBe(true);
    expect(m("llama/other/x.cpp")).toBe(false);
    expect(m("xllama/llama.cpp/a.c")).toBe(false); // anchored at the repository root
  });
  it("supports ** across levels (and zero levels), * inside a folder and ? for one character", () => {
    expect(m("third_party/a.c")).toBe(true);
    expect(m("third_party/x/y/z.c")).toBe(true);
    expect(m("third_party/x/y/z.h")).toBe(false);
    expect(m("docs/api1.md")).toBe(true);
    expect(m("docs/api12.md")).toBe(false);
    expect(m("a.gen.ts")).toBe(true);
    expect(m("src/a.gen.ts")).toBe(false); // * does not cross a slash
  });
  it("a plain folder name covers the folder, and an empty list matches nothing", () => {
    expect(globMatcher(["vendor_copy"])("vendor_copy/x.py")).toBe(true);
    expect(globMatcher([])("anything")).toBe(false);
    expect(globMatcher(undefined)("anything")).toBe(false);
  });
});

describe("mainPackage tag rule (tag shapes from n8n, context7, a python-v repo)", () => {
  const n8n = { mainPackage: "n8n@" };
  it("reads the version after the package name, and counts every other versioned tag as another package", () => {
    expect(classifyTag("n8n@2.45.7", n8n)).toBe("stable");
    expect(classifyTag("n8n@2.45.7-beta.1", n8n)).toBe("pre");
    expect(classifyTag("n8n@2.45.7-exp.0", n8n)).toBe("pre");
    expect(classifyTag("@n8n/core@1.9.0", n8n)).toBe("package");
    expect(classifyTag("v1.2.3", n8n)).toBe("package"); // a plain version tag is not this package
    expect(classifyTag("latest", n8n)).toBe("other");
    expect(classifyTag("n8n@latest", n8n)).toBe("other");
  });
  it("works for scoped names and prefixes like python-v", () => {
    const ctx = { mainPackage: "@upstash/context7-sdk@" };
    expect(classifyTag("@upstash/context7-sdk@0.6.0", ctx)).toBe("stable");
    expect(classifyTag("@upstash/context7-mcp@2.0.1", ctx)).toBe("package");
    const py = { mainPackage: "python-v" };
    expect(classifyTag("python-v4.2.4", py)).toBe("stable");
    expect(classifyTag("python-v4.2.4rc1", py)).toBe("pre");
    expect(classifyTag("node-v1.0.0", py)).toBe("package");
  });
  it("keeps the regex rules as the escape hatch, and never promotes another package to the release line", () => {
    expect(classifyTag("n8n@2.45.7", { mainPackage: "n8n@", ignore: ["^n8n@2\\.45\\."] })).toBe("ignored");
    expect(classifyTag("weird-tag", { mainPackage: "n8n@", stable: ["^weird-"] })).toBe("stable");
    const names = ["@a/pkg@1.0.0", "@a/pkg@1.1.0", "@a/pkg@1.2.0"];
    expect(mainLinePrefix(names, undefined)).toBe("@a/pkg@"); // without a rule, the commonest package is promoted
    expect(mainLinePrefix(names, { mainPackage: "n8n@" })).toBeNull(); // with one, the rule decides
  });
});

describe("rule files outside the repository", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "ga-rules-"));
    writeFileSync(path.join(dir, "agents.config.json"), JSON.stringify({ ai: ["Global Helper"], bot: [], human: [] }));
    writeFileSync(
      path.join(dir, "release-rules.json"),
      JSON.stringify({
        "acme/widget": { mainPackage: "widget@", vendored: ["third_party/"], agents: { ai: ["Widget Pilot"] } },
        "ggml-org/llama.cpp": { rolling: ["^custom-\\d+$"] }, // replaces the shipped entry for this repository
      }),
    );
    writeFileSync(path.join(dir, "mine.json"), JSON.stringify({ ai: ["Explicit File Agent"] }));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads agent names from --rules-dir, and --agents-config wins over it", async () => {
    process.env.GIT_ANALYTICS_RULES_DIR = dir;
    expect((await loadOverrides()).ai).toEqual(["Global Helper"]);
    process.env.GIT_ANALYTICS_AGENTS_CONFIG = path.join(dir, "mine.json");
    expect((await loadOverrides()).ai).toEqual(["Explicit File Agent"]);
  });

  it("reads per-repository rules from the folder; its entry replaces the shipped one, and shipped rules still apply elsewhere", async () => {
    process.env.GIT_ANALYTICS_RULES_DIR = dir;
    const r = await loadRepoRules("Acme/Widget");
    expect(r).toMatchObject({ mainPackage: "widget@", vendored: ["third_party/"], agents: { ai: ["Widget Pilot"] } });
    expect((await loadRepoRules("ggml-org/llama.cpp"))?.rolling).toEqual(["^custom-\\d+$"]);
    expect(await loadRepoRules("openai/codex")).toBeDefined(); // shipped, generic
    expect(await loadRepoRules("nobody/nothing")).toBeUndefined();
  });

  it("merges global and repository-only agent names", () => {
    expect(mergeAgentOverrides({ ai: ["A"], human: ["H"] }, { ai: ["B"], bot: ["Z"] })).toEqual({ ai: ["A", "B"], bot: ["Z"], human: ["H"] });
    const g = { ai: ["A"] };
    expect(mergeAgentOverrides(g, undefined)).toBe(g);
  });

  it("changes what a cached analysis must match only for repositories with such rules", async () => {
    const before = await currentRules("acme/widget");
    const other = await currentRules("acme/other");
    process.env.GIT_ANALYTICS_RULES_DIR = dir;
    const after = await currentRules("acme/widget");
    expect(after.vendoredId).not.toBe("");
    expect(after.classifier).not.toBe(before.classifier); // repository-only agent names
    expect(after.releaseRulesId).not.toBe(before.releaseRulesId); // mainPackage
    const otherAfter = await currentRules("acme/other");
    expect(otherAfter.vendoredId).toBe("");
    // a repository without rules keeps its release id; the classifier only moves because the global list differs
    expect(otherAfter.releaseRulesId).toBe(other.releaseRulesId);
  });
});

// ---- a real repository with a vendored folder, a repository-only agent and package-prefixed tags --------------------------
describe("per-repository rules on a real repository", () => {
  let dir = "";
  let rules = "";
  function git(args: string[], date?: string, who = "Ann Dev") {
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: who,
      GIT_AUTHOR_EMAIL: `${who.replace(/\s+/g, ".").toLowerCase()}@example.com`,
      GIT_COMMITTER_NAME: who,
      GIT_COMMITTER_EMAIL: "ann@example.com",
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    };
    return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: dir, env, encoding: "utf8" }).trim();
  }
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";
  function commit(date: string, files: Record<string, string>, tags: string[] = [], who?: string) {
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      writeFileSync(path.join(dir, f), body);
    }
    git(["add", "-A"]);
    git(["commit", "-m", `change ${date}`], date, who);
    for (const t of tags) git(["tag", t]);
  }

  beforeAll(() => {
    dir = path.join(mkdtempSync(path.join(os.tmpdir(), "ga-rules-repo-")), "widget");
    mkdirSync(dir);
    git(["init", "-q", "-b", "main"]);
    commit("2026-02-01T12:00:00Z", { "src/app.ts": lines(100) }, ["widget@1.0.0", "other@9.9.9"]);
    commit("2026-03-01T12:00:00Z", { "third_party/lib/big.ts": lines(3000) }, ["widget@1.1.0"]);
    commit("2026-04-01T12:00:00Z", { "src/more.ts": lines(50) }, ["widget@1.2.0-beta.1"], "Widget Pilot");
    rules = mkdtempSync(path.join(os.tmpdir(), "ga-rules-dir-"));
    writeFileSync(
      path.join(rules, "release-rules.json"),
      JSON.stringify({ [path.basename(dir).toLowerCase()]: { mainPackage: "widget@", vendored: ["third_party/"], agents: { ai: ["Widget Pilot"] } } }),
    );
  }, 60_000);
  afterAll(() => {
    rmSync(path.dirname(dir), { recursive: true, force: true });
    rmSync(rules, { recursive: true, force: true });
  });

  it("without rules the vendored folder counts and the pilot is a person", async () => {
    const data = await analyze(dir);
    expect(data.snapshots.at(-1)?.loc).toBe(3150);
    expect(data.agents).toEqual([]);
    expect(data.vendoredId).toBe("");
  });

  it("with rules the vendored folder is left out of code size and lines added, the agent is recognised, and the tags are read per package", async () => {
    process.env.GIT_ANALYTICS_RULES_DIR = rules;
    const data = await analyze(dir);
    expect(data.snapshots.at(-1)?.loc).toBe(150); // 100 + 50, third_party excluded
    expect(data.commits.map((c) => c.add)).toEqual([100, 0, 50]);
    expect(data.agents).toEqual(["Widget Pilot"]);
    expect(data.commits.at(-1)?.ag).toEqual([0]);
    expect(data.vendoredId).not.toBe("");

    const report = (await buildFullReport(data, null, { asOf: parseAsOf("2026-04-30"), sections: ["summary"] })) as unknown as {
      meta: { tagCounts: Record<string, number>; rulesApplied: { vendored: string[]; agents: { ai: string[] }; release: { mainPackage: string } } };
      summary: { codeLines: number };
    };
    expect(report.summary.codeLines).toBe(150);
    expect(report.meta.rulesApplied).toMatchObject({ vendored: ["third_party/"], agents: { ai: ["Widget Pilot"] }, release: { mainPackage: "widget@" } });
    expect(report.meta.tagCounts).toMatchObject({ stable: 2, pre: 1, package: 1, other: 0, total: 4 });
  });
});

// ---- A8: safe cloning -----------------------------------------------------------------------------------------------------
describe("safe cloning", () => {
  let src = "";
  let out = "";
  beforeAll(() => {
    src = mkdtempSync(path.join(os.tmpdir(), "ga-clone-src-"));
    out = mkdtempSync(path.join(os.tmpdir(), "ga-clone-out-"));
    const g = (args: string[]) =>
      execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
        cwd: src,
        encoding: "utf8",
        env: { ...process.env, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@x.io", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@x.io" },
      });
    g(["init", "-q", "-b", "main"]);
    writeFileSync(path.join(src, "a.ts"), "export const a = 1;\n");
    // a submodule reference and an executable hook in the source: neither may be fetched or installed
    writeFileSync(path.join(src, ".gitmodules"), '[submodule "evil"]\n\tpath = evil\n\turl = https://example.invalid/evil.git\n');
    writeFileSync(path.join(src, ".git", "hooks", "post-checkout"), "#!/bin/sh\ntouch /tmp/ga-hook-ran\n");
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "init"]);
  });
  afterAll(() => {
    rmSync(src, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it("applies the safe settings to every git call", () => {
    const joined = SAFE_GIT_ARGS.join(" ");
    for (const c of ["core.hooksPath=/dev/null", "core.fsmonitor=false", "submodule.recurse=false", "protocol.allow=never", "protocol.https.allow=always"]) {
      expect(joined).toContain(c);
    }
  });

  it("refuses non-https remotes by default (no file://, ssh, ext::)", async () => {
    const dest = path.join(out, "blocked.git");
    await expect(cloneSafely(pathToFileURL(src).href, dest)).rejects.toThrow();
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.partial`)).toBe(false);
  });

  it("clones bare with no hooks and no submodule checkout, and leaves no partial folder behind", async () => {
    const dest = path.join(out, "ok.git");
    await cloneSafely(pathToFileURL(src).href, dest, undefined, ["protocol.file.allow=always"]);
    expect(existsSync(path.join(dest, "HEAD"))).toBe(true);
    expect(existsSync(`${dest}.partial`)).toBe(false);
    const hooks = path.join(dest, "hooks");
    expect(existsSync(hooks) ? readdirSync(hooks) : []).toEqual([]); // --template= installs none
    expect(existsSync(path.join(dest, "modules"))).toBe(false); // no submodule was fetched
    expect(existsSync(path.join(dest, "evil"))).toBe(false);
  });

  it("a failed clone is cleaned up", async () => {
    const dest = path.join(out, "gone.git");
    await expect(cloneSafely(pathToFileURL(path.join(src, "nope")).href, dest, undefined, ["protocol.file.allow=always"])).rejects.toThrow();
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.partial`)).toBe(false);
  });

  it("an outer time limit still stops work inside a longer inner one", async () => {
    await expect(withTimeout(20, "outer", () => withTimeout(600_000, "inner", () => new Promise(() => {})))).rejects.toThrow(/outer timed out/);
  });
});

// ---- code size when files move across an excluded boundary ---------------------------------------------------------------------
describe("code size and moved files", () => {
  let dir = "";
  let rules = "";
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";
  const git = (args: string[], date?: string) =>
    execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@x.io", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@x.io", ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
    });
  const commit = (date: string, write: Record<string, string>, move: [string, string][] = []) => {
    for (const [f, body] of Object.entries(write)) {
      mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      writeFileSync(path.join(dir, f), body);
    }
    for (const [from, to] of move) {
      mkdirSync(path.dirname(path.join(dir, to)), { recursive: true });
      git(["mv", from, to]);
    }
    git(["add", "-A"]);
    git(["commit", "-m", date], date);
  };

  beforeAll(() => {
    dir = path.join(mkdtempSync(path.join(os.tmpdir(), "ga-move-")), "mover");
    mkdirSync(dir);
    git(["init", "-q", "-b", "main"]);
    commit("2026-01-10T12:00:00Z", { "src/keep.ts": lines(100), "src/into.ts": lines(40), "third_party/out.ts": lines(60) });
    // one file moves INTO the vendored folder, one moves OUT of it (content unchanged, so git sees plain renames)
    commit("2026-02-10T12:00:00Z", {}, [["src/into.ts", "third_party/into.ts"], ["third_party/out.ts", "src/out.ts"]]);
    rules = mkdtempSync(path.join(os.tmpdir(), "ga-move-rules-"));
    writeFileSync(path.join(rules, "release-rules.json"), JSON.stringify({ [path.basename(dir).toLowerCase()]: { vendored: ["third_party/"] } }));
  }, 60_000);
  afterAll(() => {
    rmSync(path.dirname(dir), { recursive: true, force: true });
    rmSync(rules, { recursive: true, force: true });
  });

  it("counts a file moved into or out of an excluded folder once, on the right side", async () => {
    process.env.GIT_ANALYTICS_RULES_DIR = rules;
    const data = await analyze(dir);
    // 100 (keep) + 60 (out.ts, now in src) ; into.ts (40) is vendored now and no longer counts
    expect(data.snapshots.at(-1)?.loc).toBe(160);
  });
});
