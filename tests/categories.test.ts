import { describe, expect, it } from "vitest";
import { categorize } from "../lib/categories";
import { agentFileTool } from "../lib/agent-files";

describe("categorize (source vs tests vs docs vs data)", () => {
  it.each([
    ["src/index.ts", "source"],
    ["lib/crewai/agent.py", "source"],
    ["cmd/main.go", "source"],
    ["ggml/src/ggml.c", "source"],
    ["include/llama.h", "source"],
    ["Makefile", "source"],
    ["web/components/Button.tsx", "source"],
    ["styles/app.css", "source"],
  ])("%s is %s", (f, c) => expect(categorize(f)).toBe(c));

  it.each([
    ["tests/test_agent.py", "tests"],
    ["src/foo.test.ts", "tests"],
    ["src/foo.spec.tsx", "tests"],
    ["pkg/parser_test.go", "tests"],
    ["__tests__/a.js", "tests"],
    ["conftest.py", "tests"],
  ])("%s is %s", (f, c) => expect(categorize(f)).toBe(c));

  it("keeps the crewAI documentation tree out of code size", () => {
    // a full docs copy per release: .mdx and anything else under docs/
    expect(categorize("docs/v1.15.31/en/concepts/agents.mdx")).toBe("docs");
    expect(categorize("docs/v1.15.32/en/concepts/agents.mdx")).toBe("docs");
    expect(categorize("docs/conf.py")).toBe("docs"); // code extension, but inside docs/
    expect(categorize("README.md")).toBe("docs");
    expect(categorize("CHANGELOG.rst")).toBe("docs");
  });

  it.each([
    ["package.json", "data"],
    ["config/settings.yaml", "data"],
    ["pyproject.toml", "data"],
    ["data/rows.csv", "data"],
    ["index.html", "data"],
    ["assets/logo.bin", "other"],
    ["LICENSE", "other"],
  ])("%s is %s", (f, c) => expect(categorize(f)).toBe(c));
});

describe("agentFileTool (instruction files of the project itself)", () => {
  it.each([
    ["AGENTS.md", "AGENTS.md (generic)"],
    ["CLAUDE.md", "Claude Code"],
    [".claude/CLAUDE.md", "Claude Code"],
    ["packages/api/CLAUDE.md", "Claude Code"],
    ["GEMINI.md", "Gemini"],
    [".cursorrules", "Cursor"],
    [".cursor/rules/style.mdc", "Cursor"],
    [".github/copilot-instructions.md", "Copilot"],
    [".github/instructions/python.instructions.md", "Copilot"],
    [".windsurfrules", "Windsurf"],
  ])("%s is an instruction file (%s)", (p, tool) => expect(agentFileTool(p)).toBe(tool));

  it("rejects the false positives found in LlamaIndex, Pydantic AI and crewAI", () => {
    expect(agentFileTool("docs/docs/understanding/use_cases/agents.md")).toBeNull(); // a docs page, and not AGENTS.md
    expect(agentFileTool("docs/realtime/gemini.md")).toBeNull();
    expect(agentFileTool("lib/crewai/src/crewai/cli/templates/CLAUDE.md")).toBeNull(); // template shipped to users
    expect(agentFileTool("templates/CLAUDE.md")).toBeNull();
  });

  it("is case-sensitive: agents.md is a normal file name", () => {
    expect(agentFileTool("agents.md")).toBeNull();
    expect(agentFileTool("claude.md")).toBeNull();
    expect(agentFileTool("src/agents.md")).toBeNull();
  });

  it("ignores instruction files inside examples and tests", () => {
    expect(agentFileTool("examples/demo/AGENTS.md")).toBeNull();
    expect(agentFileTool("tests/fixtures/CLAUDE.md")).toBeNull();
    expect(agentFileTool("node_modules/pkg/AGENTS.md")).toBeNull();
  });
});
