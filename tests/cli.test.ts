import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

// Only offline commands here: the CLI must stay usable (and testable) without network or a clone.
function ga(...args: string[]) {
  return spawnSync(process.execPath, [tsx, path.join(root, "cli", "ga.ts"), ...args], { encoding: "utf8", cwd: path.join(root, "tests") });
}

describe("ga CLI (offline)", () => {
  it("describe lists every command and report section as JSON", () => {
    const r = ga("describe");
    expect(r.status).toBe(0);
    const d = JSON.parse(r.stdout);
    expect(Object.keys(d.commands)).toEqual(expect.arrayContaining(["analyze", "report", "explore", "pulls", "budget", "agents", "describe"]));
    expect(d.sections).toEqual(expect.arrayContaining(["summary", "timeline", "ai", "detection", "bulk", "pulse", "quarters"]));
  });

  it("help prints usage and exits 0", () => {
    const r = ga("help");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/ga report <repo>/);
  });

  it("reports usage errors as JSON on stderr with exit code 1", () => {
    for (const args of [["nope"], ["report"], ["report", "x/y", "--period", "decade"], ["report", "x/y", "--sections", "bogus"], ["report", "x/y", "--quarters", "0"], ["report", "x/y", "--quarters", "abc"], ["report", "x/y", "--releasing-days", "-3"], ["report", "x/y", "--pin", "not-a-sha"], ["sample", "--timeout-min", "0"], ["report", "x/y", "--rules-dir", "no/such/folder"], ["report", "x/y", "--agents-config", "no-such.json"], ["report", "x/y", "--clone-timeout-min", "0"]]) {
      const r = ga(...args);
      expect(r.status).toBe(1);
      expect(JSON.parse(r.stderr)).toMatchObject({ code: "USAGE" });
      expect(r.stdout).toBe("");
    }
  });
});
