import { describe, expect, it } from "vitest";
import { classifyIdentity, isHousekeeping } from "../lib/agents";

describe("classifyIdentity", () => {
  it("never flags real people, including the false positives from review", () => {
    expect(classifyIdentity("Azis Alvriyanto", "azis@example.com")).toBeNull();
    expect(classifyIdentity("Richard", "richard@example.com")).toBeNull();
    expect(classifyIdentity("Devin Foley", "devin@devinfoley.com")).toBeNull();
    expect(classifyIdentity("Agent Smith", "smith@example.com")).toBeNull();
    expect(classifyIdentity("Jamie Cline", "jamie@example.com")).toBeNull();
  });

  it("does not treat a generic noreply email as AI", () => {
    expect(classifyIdentity("Some Person", "noreply@somewhere.org")).toBeNull();
  });

  it.each([
    ["Claude", "noreply@anthropic.com", "Claude"],
    ["Claude Opus 4.6", "noreply@anthropic.com", "Claude"],
    ["Claude Fable 5", "noreply@anthropic.com", "Claude"],
    ["Copilot", "175728472+Copilot@users.noreply.github.com", "Copilot"],
    ["copilot-swe-agent[bot]", "", "Copilot"],
    ["Codex", "", "Codex"],
    ["Cursor Agent", "cursoragent@cursor.com", "Cursor"],
    ["devin-ai-integration[bot]", "", "Devin"],
    ["Kimi", "", "Kimi"],
    ["Qwen Code", "", "Qwen Code"],
    ["DeepSeek", "", "DeepSeek"],
    ["OpenCode", "", "OpenCode"],
    ["coderabbitai[bot]", "", "CodeRabbit"],
  ])("%s is an AI agent (%s)", (name, email, label) => {
    expect(classifyIdentity(name, email)).toEqual({ kind: "ai", label });
  });

  it("identifies AI by the exact trailer address even when the name is custom", () => {
    expect(classifyIdentity("Some Model", "noreply@anthropic.com")?.kind).toBe("ai");
  });

  it("does not flag people who merely work at an AI company (MCP Python SDK case)", () => {
    expect(classifyIdentity("Paul Carleton", "paulc@anthropic.com")).toBeNull();
    expect(classifyIdentity("Felix Weinberger", "felix@anthropic.com")).toBeNull();
    expect(classifyIdentity("Someone", "someone@openai.com")).toBeNull();
  });

  it.each(["dependabot[bot]", "github-actions[bot]", "renovate[bot]", "lockfile-bot", "release-please[bot]"])(
    "%s is an automation bot, not AI",
    (name) => expect(classifyIdentity(name)?.kind).toBe("bot"),
  );

  it("applies overrides first", () => {
    expect(classifyIdentity("Paperclip", "noreply@paperclip.ing", { ai: ["paperclip"] })).toEqual({ kind: "ai", label: "Paperclip" });
    expect(classifyIdentity("Paperclip", "noreply@paperclip.ing")).toBeNull();
    expect(classifyIdentity("Claude", "", { human: ["claude"] })).toBeNull();
  });
});

describe("isHousekeeping", () => {
  it.each(["Revert \"feat: x\"", "chore(release): bump version to 1.2.3", "Bump version 2.0.0", "v1.2.3", "Release v1.2.3"])(
    "%s is housekeeping",
    (s) => expect(isHousekeeping(s)).toBe(true),
  );
  it.each(["feat: add release notes", "fix: handle revert of a merge", "Add bump allocator"])("%s is real work", (s) =>
    expect(isHousekeeping(s)).toBe(false),
  );
});
