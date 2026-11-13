// Which files count toward line statistics. Generated, vendored and data files would swamp
// real code growth (a single bulk import can add more lines than a year of development).

const IGNORED_PATHS: RegExp[] = [
  // lockfiles
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|go\.sum|composer\.lock|Gemfile\.lock|Podfile\.lock|flake\.lock)$/,
  /\.lock$/,
  // minified, bundles, source maps
  /\.min\.(js|css)$/,
  /\.(map|bundle\.js|chunk\.js)$/,
  // vendored / build output
  /(^|\/)(node_modules|vendor|dist|build|\.next|Pods)\//,
  // test snapshots, fixtures and datasets
  /(^|\/)(__snapshots__|__fixtures__|fixtures?|testdata|test_data|test-data|datasets?|snapshots)\//i,
  /\.snap$/,
  // generated code
  /\.(pb\.go|pb\.ts|pb\.js)$/,
  /_pb2(_grpc)?\.pyi?$/,
  /(^|[._-])generated[._-]|\.g\.dart$|\.gen\.(ts|go)$/i,
  // binary / media / data formats
  /\.(svg|png|jpe?g|gif|ico|webp|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|parquet|csv|tsv|jsonl|ndjson|ipynb|onnx|pt|bin)$/i,
];

/** Data-like formats: excluded when a single file in a commit is large, even if the path looks normal. */
const DATA_EXT = /\.(json|ya?ml|xml|txt|sql|html|md|toml|ini|log)$/i;
export const DATA_FILE_LINES = 2000;

export function isIgnoredPath(file: string): boolean {
  return IGNORED_PATHS.some((re) => re.test(file));
}

/** Large data-like file (a JSON dump, big SQL seed, ...): not hand-written code growth. */
export function isBulkDataFile(file: string, changedLines: number): boolean {
  return changedLines > DATA_FILE_LINES && DATA_EXT.test(file);
}

/** A commit above this many counted lines is flagged as a bulk commit. */
export const BULK_COMMIT_LINES = 5000;

/** `git diff -M --numstat` writes renames as "dir/{old => new}/file" or "old => new"; return the new path. */
export function newPathOf(raw: string): string {
  if (raw.includes("{") && raw.includes(" => ")) {
    return raw.replace(/\{[^}]*? => ([^}]*)\}/, "$1").replace(/\/{2,}/g, "/");
  }
  return raw.includes(" => ") ? raw.split(" => ")[1] : raw;
}
