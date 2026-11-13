// Files that give AI coding agents instructions for a project (AGENTS.md, CLAUDE.md, .cursor/rules, ...).
// Exact, case-sensitive names, and never inside documentation, templates, examples or test folders: a docs page
// called agents.md, or a CLAUDE.md template the project ships to its users, is not an instruction file for the project.

/** Folders whose contents describe or ship something else, not this project's own agent setup. */
const NOT_THE_PROJECTS_OWN = /(^|\/)(docs?|documentation|templates?|examples?|samples?|cookbook|fixtures?|testdata|tests?|__tests__|node_modules|vendor|third_party|site|website|content)\//i;

const FILES: [RegExp, string][] = [
  [/(^|\/)AGENTS\.md$/, "AGENTS.md (generic)"],
  [/(^|\/)CLAUDE\.md$/, "Claude Code"],
  [/(^|\/)GEMINI\.md$/, "Gemini"],
  [/(^|\/)QWEN\.md$/, "Qwen Code"],
  [/(^|\/)\.cursorrules$|(^|\/)\.cursor\/rules\/[^/]+$/, "Cursor"],
  [/(^|\/)\.windsurfrules$|(^|\/)\.windsurf\/rules\/[^/]+$/, "Windsurf"],
  [/(^|\/)\.clinerules$|(^|\/)\.clinerules\/[^/]+$/, "Cline"],
  [/^\.github\/copilot-instructions\.md$|^\.github\/instructions\/[^/]+\.md$/, "Copilot"],
  [/^\.junie\/guidelines\.md$/, "Junie"],
  [/^\.kiro\/steering\/[^/]+$/, "Kiro"],
];

/** The tool a path gives instructions to, or null if it is not an instruction file of the project itself. */
export function agentFileTool(path: string): string | null {
  if (NOT_THE_PROJECTS_OWN.test(path)) return null;
  for (const [re, tool] of FILES) if (re.test(path)) return tool;
  return null;
}
