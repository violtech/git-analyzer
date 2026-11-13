import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyTag, mainLinePrefix, releaseKey, releaseStyle, type ReleaseRules } from "../lib/tags";

describe("classifyTag", () => {
  it.each(["v1.2.3", "1.2.3", "v0.9.0", "2026.1005.0", "v2026.1005.0", "release-1.2.3", "release/v1.2.3", "v1.2.3.4"])(
    "%s is a main-line stable release",
    (t) => expect(classifyTag(t)).toBe("stable"),
  );

  it.each(["@hono/bun@1.2.3", "@hono/node-server@1.19.0", "pkg-v1.2.3", "core/v2.0.0", "hono-bun@0.1.0"])(
    "%s is a monorepo package tag, not a release",
    (t) => expect(classifyTag(t)).toBe("package"),
  );

  it.each(["v1.2.3-rc.1", "1.0.0-beta.2", "canary/v2026.1030.0-canary.4", "v3.0.0-alpha", "nightly-2026-10-01", "v1.2.3-dev.5"])(
    "%s is a pre-release",
    (t) => expect(classifyTag(t)).toBe("pre"),
  );

  it.each(["latest", "v1", "release-2024", "stable"])("%s is not a version", (t) => expect(classifyTag(t)).toBe("other"));

  it("does not mistake words containing rc/dev for pre-release markers", () => {
    expect(classifyTag("v1.2.3")).toBe("stable");
    expect(classifyTag("source-v1.2.3")).toBe("package");
    expect(classifyTag("arcade@1.0.0")).toBe("package");
  });
});

describe("mainLinePrefix", () => {
  it("is null when a main-line stable tag exists", () => {
    expect(mainLinePrefix(["v1.0.0", "@a/b@1.0.0"])).toBeNull();
  });
  it("promotes the most common package prefix when there is no main line", () => {
    expect(mainLinePrefix(["core-v1.0.0", "core-v1.1.0", "cli-v0.1.0"])).toBe("core-v");
  });
});

// The rules that actually ship in release-rules.json, so the file users edit is the file under test.
const RULES = JSON.parse(readFileSync(path.join(__dirname, "..", "release-rules.json"), "utf8")) as Record<string, ReleaseRules>;

// Tag shapes taken from the real repositories (git ls-remote), not invented.
describe("real-world tag shapes", () => {
  describe("litellm (no rules needed)", () => {
    it.each(["v0.1.387", "v1.32.33", "v1.32.33-stable", "v1.73.6-stable.patch.1", "v1.50.1-stable.1"])("%s is a release", (t) =>
      expect(classifyTag(t)).toBe("stable"),
    );
    it.each(["v1.16.20.dev1", "v1.61.11-nightly", "v1.72.2.rc.2", "v1.100.0-rc.1", "v1.100.0-dev.1", "v1.77.1.dev.1", "v1.31.12-dev1", "1.34.28.dev3"])(
      "%s is a pre-release build",
      (t) => expect(classifyTag(t)).toBe("pre"),
    );
    it("counts v1.32.33 and v1.32.33-stable as one release, but a stable patch as its own", () => {
      expect(releaseKey("v1.32.33")).toBe(releaseKey("v1.32.33-stable"));
      expect(releaseKey("v1.73.6-stable.patch.1")).not.toBe(releaseKey("v1.73.6-stable"));
      expect(releaseKey("v1.50.1-stable.1")).toBe("1.50.1+p1");
    });
  });

  describe("codex (rust-v… prefix, mostly alphas)", () => {
    const rules = RULES["openai/codex"];
    it("without rules the main line is promoted from the prefix", () => {
      expect(mainLinePrefix(["rust-v0.1.0", "rust-v0.2.0", "rust-v0.1.0-alpha.1", "python-v0.144.4"])).toBe("rust-v");
    });
    it("with the shipped rules: releases, alphas and junk are told apart", () => {
      expect(classifyTag("rust-v0.0.2504291921", rules)).toBe("stable");
      expect(classifyTag("rust-v0.146.0-alpha.10.1", rules)).toBe("pre");
      expect(classifyTag("rust-v0.11.0-beta.1", rules)).toBe("pre");
      expect(classifyTag("rust-vrust-v0.122.0-alpha.4", rules)).toBe("ignored");
      expect(classifyTag("rust-vv0.81.0-alpha.11", rules)).toBe("ignored");
      expect(classifyTag("rusty-v8-v146.4.0", rules)).toBe("ignored");
      expect(classifyTag("python-v0.144.4", rules)).toBe("ignored");
    });
  });

  describe("langchain (v-tags, then package==version)", () => {
    const rules = RULES["langchain-ai/langchain"];
    it("counts the legacy line and the langchain package, not the other packages", () => {
      expect(classifyTag("v0.0.1", rules)).toBe("stable");
      expect(classifyTag("langchain==0.1.17", rules)).toBe("stable");
      expect(classifyTag("langchain-core==0.1.47", rules)).toBe("package");
      expect(classifyTag("langchain-openai==0.1.10", rules)).toBe("package");
    });
    it("the same version under both tag styles is one release", () => {
      expect(releaseKey("v0.3.5")).toBe(releaseKey("langchain==0.3.5"));
    });
  });

  describe("llama.cpp (build numbers)", () => {
    const rules = RULES["ggml-org/llama.cpp"];
    it("bNNNN are builds, not releases, even without rules", () => {
      expect(classifyTag("b10000")).toBe("rolling");
      expect(classifyTag("b5000", rules)).toBe("rolling");
    });
    it("old master-<sha> and gguf-v tags are not releases", () => {
      expect(classifyTag("master-0035858", rules)).toBe("ignored");
      expect(classifyTag("gguf-v0.10.0", rules)).toBe("ignored");
      expect(classifyTag("master-0035858")).toBe("other");
    });
    it("real v-tags are still releases", () => {
      expect(classifyTag("v0.1.0", rules)).toBe("stable");
    });
  });
});

describe("releaseStyle", () => {
  it("detects rolling builds, calendar and semver", () => {
    expect(releaseStyle(["v0.1.0", "v0.2.0"], 7538)).toBe("rolling-builds");
    expect(releaseStyle(["v2026.1005.0", "v2026.1012.0"], 0)).toBe("calendar");
    expect(releaseStyle(["v1.0.0", "v1.1.0", "v2.0.0"], 5)).toBe("semver");
    expect(releaseStyle([], 0)).toBe("none");
  });
});
