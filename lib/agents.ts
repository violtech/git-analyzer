// Strict identification of AI coding agents and (separately) automation bots.
// Precision over recall: an identity counts as AI only if it is on this allowlist or in the
// user's agents.config.json. The AI share is therefore a lower bound.
//
// Real people with similar names ("Devin Foley", "Richard") are never matched: every rule is
// anchored to the start of the name or to a specific email.

export type IdentityKind = "ai" | "bot";
export type AuthorKind = "all" | "developers" | "ai" | "bots";

export interface Identity {
  kind: IdentityKind;
  /** canonical label, e.g. "Claude" for "Claude Opus 4.6" */
  label: string;
}

export interface AgentOverrides {
  /** exact names (case-insensitive) always treated as AI agents */
  ai?: string[];
  /** exact names always treated as automation bots */
  bot?: string[];
  /** exact names never treated as agents or bots */
  human?: string[];
}

/** Bump when the rules below change so cached analyses are recomputed. */
export const RULES_VERSION = "4";

const AI_RULES: [RegExp, string][] = [
  [/^claude\b/i, "Claude"],
  [/^(github[- ])?copilot\b/i, "Copilot"],
  [/^copilot-swe-agent/i, "Copilot"],
  [/^codex\b|^chatgpt-codex-connector|^openai codex/i, "Codex"],
  [/^cursor( ?agent)?$|^cursoragent/i, "Cursor"],
  [/^gemini\b/i, "Gemini"],
  [/^jules$|^google-labs-jules/i, "Jules"],
  [/^devin$|^devin-ai-integration/i, "Devin"],
  [/^aider\b/i, "Aider"],
  [/^openhands/i, "OpenHands"],
  [/^sweep( ai)?$|^sweep-ai/i, "Sweep"],
  [/^amp$/i, "Amp"],
  [/^junie\b/i, "Junie"],
  [/^windsurf\b/i, "Windsurf"],
  [/^cline\b/i, "Cline"],
  [/^kiro\b/i, "Kiro"],
  [/^trae( agent)?$/i, "Trae"],
  [/^kimi\b/i, "Kimi"],
  [/^qwen( ?code)?\b/i, "Qwen Code"],
  [/^deepseek\b/i, "DeepSeek"],
  [/^opencode\b/i, "OpenCode"],
  [/^factory-droid|^droid$/i, "Factory Droid"],
  [/^grok\b/i, "Grok"],
  // AI code-review bots that the reviewed sample counts as AI
  [/^coderabbitai/i, "CodeRabbit"],
  [/^cubic-dev-ai|^codebeaver-ai|^codeflash-ai|^veria-ai|^hyperlint-ai|^macroscopeapp/i, "AI review bot"],
];

// Exact addresses only. A whole domain (@anthropic.com) would also match the people who work there.
const AI_EMAIL: [RegExp, string][] = [
  [/^noreply@anthropic\.com$/i, "Claude"],
  [/^cursoragent@cursor\.com$/i, "Cursor"],
  [/\+copilot@users\.noreply\.github\.com$/i, "Copilot"],
];

const BOT_NAME =
  /\[bot\]$|^(dependabot|renovate|github-actions|release-please|stainless|lockfile-bot|greenkeeper|snyk-bot|pre-commit-ci|allcontributors|semantic-release|mergify|imgbot|commitperclip)|(^|[-_ ])bot$/i;

const lc = (xs?: string[]) => new Set((xs ?? []).map((x) => x.trim().toLowerCase()));

/** Returns the identity kind and canonical label, or null for a human. */
export function classifyIdentity(name: string, email = "", overrides: AgentOverrides = {}): Identity | null {
  const n = name.trim();
  const key = n.toLowerCase();
  if (lc(overrides.human).has(key)) return null;
  if (lc(overrides.ai).has(key)) return { kind: "ai", label: n };
  if (lc(overrides.bot).has(key)) return { kind: "bot", label: n };

  const e = email.trim().replace(/^<|>$/g, "");
  for (const [re, label] of AI_RULES) if (re.test(n)) return { kind: "ai", label };
  for (const [re, label] of AI_EMAIL) if (re.test(e)) return { kind: "ai", label };
  if (BOT_NAME.test(n)) return { kind: "bot", label: n.replace(/\s+/g, " ") };
  return null;
}

/** Commits that should not count toward the AI-share denominator (reverts, version bumps). */
export const isHousekeeping = (subject: string) =>
  /^revert\b/i.test(subject) || /^(chore(\(.*\))?: )?(bump|release)\b.*\bv?\d+\.\d+/i.test(subject) || /^v?\d+\.\d+\.\d+$/.test(subject.trim());
