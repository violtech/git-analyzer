import { describe, expect, it } from "vitest";
import { isBulkDataFile, isIgnoredPath, newPathOf } from "../lib/paths";

describe("isIgnoredPath", () => {
  it.each([
    "package-lock.json", "web/pnpm-lock.yaml", "uv.lock", "dist/app.js", "src/__snapshots__/a.snap",
    "tests/fixtures/big.json", "internal/testdata/x.txt", "api/foo.pb.go", "src/foo_generated.ts",
    "notebooks/analysis.ipynb", "data/rows.csv", "static/logo.svg", "vendor/lib/a.go",
  ])("ignores %s", (f) => expect(isIgnoredPath(f)).toBe(true));

  it.each(["src/index.ts", "lib/data.py", "docs/guide.md", "package.json", "README.md", "src/datasets.ts"])(
    "keeps %s",
    (f) => expect(isIgnoredPath(f)).toBe(false),
  );
});

describe("isBulkDataFile", () => {
  it("flags very large data-like files only", () => {
    expect(isBulkDataFile("seed/users.json", 50000)).toBe(true);
    expect(isBulkDataFile("migrations/seed.sql", 3000)).toBe(true);
    expect(isBulkDataFile("config.json", 40)).toBe(false);
    expect(isBulkDataFile("src/parser.ts", 50000)).toBe(false);
  });
});

describe("newPathOf", () => {
  it.each([
    ["src/{old => new}/file.ts", "src/new/file.ts"],
    ["{a => b}/x.ts", "b/x.ts"],
    ["old.ts => new.ts", "new.ts"],
    ["src/{ => sub}/x.ts", "src/sub/x.ts"],
    ["plain/path.ts", "plain/path.ts"],
  ])("%s -> %s", (raw, expected) => expect(newPathOf(raw)).toBe(expected));
});
