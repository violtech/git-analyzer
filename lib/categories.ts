// What kind of file is this? Code size should count what people wrote as software, not the documentation
// tree (a docs site can hold hundreds of MB of .mdx, even one full copy per release) or data files.

export type FileCategory = "source" | "tests" | "docs" | "data" | "other";

export const CATEGORIES: FileCategory[] = ["source", "tests", "docs", "data", "other"];

export type Breakdown = Record<FileCategory, number>;

export const emptyBreakdown = (): Breakdown => ({ source: 0, tests: 0, docs: 0, data: 0, other: 0 });

const CODE_EXT = new Set(
  (
    "ts tsx js jsx mjs cjs mts cts py pyi pyx rs go java kt kts scala groovy rb php c h cc cpp cxx hpp hh hxx cs fs vb swift m mm " +
    "dart lua sh bash zsh fish ps1 bat cmd r jl ex exs erl hrl hs ml mli clj cljs vue svelte astro zig nim cu cuh metal glsl wgsl " +
    "proto sql css scss sass less gradle tf"
  ).split(" "),
);
// files with no (useful) extension that are source
const CODE_NAMES = /^(Makefile|Dockerfile|CMakeLists\.txt|Rakefile|Gemfile|Justfile|BUILD|WORKSPACE|Jenkinsfile)$/;
const DOC_EXT = new Set(["md", "mdx", "rst", "adoc", "txt", "tex", "org"]);
const DATA_EXT = new Set(["json", "jsonc", "yaml", "yml", "toml", "ini", "cfg", "conf", "xml", "properties", "env", "plist", "csv", "tsv", "log", "html", "htm"]);

const DOC_DIR = /(^|\/)(docs?|documentation|doc-site|website|site|wiki|changelog)\//i;
const TEST_DIR = /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|playwright|testing|test_utils|integration-tests?)\//i;
const TEST_FILE = /(\.|_|-)(test|spec)\.[a-z0-9]+$|(^|\/)test_[^/]+\.py$|(^|\/)[^/]*_test\.(go|py|rs|cc|cpp|rb)$|(^|\/)conftest\.py$/i;

export function categorize(file: string): FileCategory {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";

  if (DOC_DIR.test(file)) return "docs"; // everything under docs/, whatever the extension
  if (DOC_EXT.has(ext)) return "docs";
  const isCode = CODE_EXT.has(ext) || CODE_NAMES.test(base);
  if (isCode) return TEST_DIR.test(file) || TEST_FILE.test(file) ? "tests" : "source";
  if (DATA_EXT.has(ext)) return "data";
  return "other";
}
