export type TagKind = "stable" | "pre" | "rolling" | "package" | "other" | "ignored";

/** Per-repo overrides (release-rules.json), as regex source strings tested against the tag name, case-insensitive. */
export interface ReleaseRules {
  /** tags that are real releases of the project (checked last) */
  stable?: string[];
  /** pre-release / channel builds: rc, alpha, nightly, dev ... */
  pre?: string[];
  /** continuous build numbers such as llama.cpp's b1234: counted as builds, not releases */
  rolling?: string[];
  /** not part of this project's releases at all (other packages, malformed or legacy tags) */
  ignore?: string[];
  /**
   * For repositories whose tags carry the package name: the tag text before the version, e.g. "n8n@", "@upstash/context7-sdk@" or
   * "python-v". Tags that start with it are that project's releases (the rest of the tag is read as a normal version); every other
   * versioned tag in the repository counts as another package. The regex lists above still win when they match.
   */
  mainPackage?: string;
}

// version core anywhere in the tag; prefix and suffix are inspected separately
const VERSION = /^(.*?)(\d+\.\d+\.\d+)(.*)$/;
// prefixes that still mean "the main release line": "", "v", "release-", "version/"
const MAIN_PREFIX = /^(v|r|rel|release|releases|version)?[-_/ ]?v?$/i;
const PRE_WORD = /(^|[^a-z])(canary|nightly|beta|alpha|preview|snapshot|dev|rc\d*|pre)([^a-z]|$)/i;
// a suffix that marks a promoted / vetted release: -stable, -stable.2, -stable.patch.1, -final, -lts, -ga
const PROMOTED = /^[-._+]?(stable|final|ga|lts)([-._]?(patch[-._]?)?\d+)?$/i;
// continuous build numbers: b1234, b10000
const ROLLING = /^b\d{3,}$/;

const matches = (patterns: string[] | undefined, name: string) => !!patterns?.some((p) => new RegExp(p, "i").test(name));

/**
 * Classifies a git tag. Defaults handle common shapes; `rules` override them for one repository.
 * - stable:  main-line semver (v1.2.3, 2026.1005.0, v1.2.3.4) or a promoted one (v1.2.3-stable, -stable.patch.1)
 * - pre:     rc / alpha / beta / dev / nightly / canary builds, or any unrecognised suffix
 * - rolling: continuous build numbers (b1234)
 * - package: monorepo package tags (@scope/pkg@1.2.3, pkg-v1.2.3, pkg==1.2.3)
 * - other:   not a version (latest, v1, master-0035858)
 * - ignored: excluded by a repository rule
 */
export function classifyTag(name: string, rules?: ReleaseRules): TagKind {
  if (rules) {
    if (matches(rules.ignore, name)) return "ignored";
    if (matches(rules.pre, name)) return "pre";
    if (matches(rules.rolling, name)) return "rolling";
    if (matches(rules.stable, name)) return "stable";
  }
  if (rules?.mainPackage) return classifyWithMainPackage(name, rules.mainPackage);
  if (ROLLING.test(name)) return "rolling";

  const m = name.match(VERSION);
  if (!m) return PRE_WORD.test(name) ? "pre" : "other";
  const [, prefix, , suffix] = m;
  if (PRE_WORD.test(prefix)) return "pre";

  let kind: "stable" | "pre";
  if (!suffix || /^\.\d+$/.test(suffix) || suffix.startsWith("+") || PROMOTED.test(suffix)) kind = "stable";
  else kind = "pre"; // dev/rc/nightly words, build letters (b1), or anything unrecognised: do not call it a release
  if (kind === "pre") return "pre";
  return MAIN_PREFIX.test(prefix) ? "stable" : "package";
}

function classifyWithMainPackage(name: string, prefix: string): TagKind {
  if (name.startsWith(prefix)) {
    // the part after the package name is read like any main-line tag: 2.45.7 is stable, 2.45.7-beta.1 is a pre-release
    const kind = classifyTag("v" + name.slice(prefix.length));
    return kind === "stable" || kind === "pre" ? kind : "other";
  }
  const kind = classifyTag(name);
  return kind === "stable" || kind === "pre" || kind === "rolling" ? "package" : kind;
}

/**
 * Identity of a release, so the same version tagged twice counts once:
 * v1.32.33 and v1.32.33-stable are one release; v1.73.6-stable.patch.1 is a separate patch release.
 */
export function releaseKey(name: string): string {
  const m = name.match(VERSION);
  if (!m) return name;
  const patch = m[3].match(/^[-._+]?stable[-._]?(?:patch[-._]?)?(\d+)$/i);
  return patch ? `${m[2]}+p${patch[1]}` : m[2];
}

/**
 * Some repos only publish package-prefixed tags (e.g. "rust-v1.2.3"). If a repo has no main-line
 * stable tag at all, promote the most common package prefix to be its release line.
 */
export function mainLinePrefix(names: string[], rules?: ReleaseRules): string | null {
  if (rules?.mainPackage) return null; // the rules already name the release line
  if (names.some((n) => classifyTag(n, rules) === "stable")) return null;
  const counts = new Map<string, number>();
  for (const n of names) {
    if (classifyTag(n, rules) !== "package") continue;
    const prefix = n.match(VERSION)?.[1] ?? "";
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [p, c] of counts) if (c > bestN) [best, bestN] = [p, c];
  return best;
}

export type ReleaseStyle = "semver" | "calendar" | "rolling-builds" | "none";

/** How the project versions what it ships; decides which release charts make sense. */
export function releaseStyle(stableNames: string[], rolling: number): ReleaseStyle {
  if (rolling >= 20 && rolling > stableNames.length * 3) return "rolling-builds";
  if (!stableNames.length) return rolling ? "rolling-builds" : "none";
  const calendar = stableNames.filter((n) => Number(n.match(VERSION)?.[2].split(".")[0]) >= 2000).length;
  return calendar > stableNames.length / 2 ? "calendar" : "semver";
}
