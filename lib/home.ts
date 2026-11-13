import path from "node:path";

/** Project root: where .cache/ and the shipped rule files live. The CLI sets GIT_ANALYTICS_HOME so it works from any folder. */
export const HOME = process.env.GIT_ANALYTICS_HOME ?? process.cwd();
export const CACHE_ROOT = path.join(HOME, ".cache");

// Rules can live outside this repository. These are read when used (not at import), so the CLI can set them from flags:
//   GIT_ANALYTICS_RULES_DIR      folder holding agents.config.json and/or release-rules.json
//   GIT_ANALYTICS_AGENTS_CONFIG  one agents file; wins over the rules folder
/** Folder that holds the user's rule files (default: the project root). */
export const rulesDir = () => process.env.GIT_ANALYTICS_RULES_DIR || HOME;
/** The agent-name list in use: --agents-config, else agents.config.json in the rules folder. */
export const agentsConfigFile = () => process.env.GIT_ANALYTICS_AGENTS_CONFIG || path.join(rulesDir(), "agents.config.json");
/** Per-repository rules in the rules folder. Entries override the ones shipped in the project root, repository by repository. */
export const releaseRulesFile = () => path.join(rulesDir(), "release-rules.json");
/** The rules shipped with the analyzer (generic, public repositories only). */
export const shippedRulesFile = () => path.join(HOME, "release-rules.json");
