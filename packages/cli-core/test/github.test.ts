import { describe, test, expect } from "bun:test";
import { parseGitHubUrl } from "../src/templates/github.js";

describe("parseGitHubUrl", () => {
  // --- Shorthand format ---

  test("github:user/repo → defaults to main", () => {
    const ref = parseGitHubUrl("github:user/repo");
    expect(ref).toEqual({ owner: "user", repo: "repo", ref: "main", subdir: undefined });
  });

  test("github:user/repo#branch → uses specified branch", () => {
    const ref = parseGitHubUrl("github:user/repo#develop");
    expect(ref).toEqual({ owner: "user", repo: "repo", ref: "develop", subdir: undefined });
  });

  test("github:user/repo/subdir → extracts subdir", () => {
    const ref = parseGitHubUrl("github:user/repo/templates/hono");
    expect(ref).toEqual({ owner: "user", repo: "repo", ref: "main", subdir: "templates/hono" });
  });

  test("github:user/repo/subdir#branch → subdir + branch", () => {
    const ref = parseGitHubUrl("github:kitn-ai/kitn/templates/hono#v2");
    expect(ref).toEqual({ owner: "kitn-ai", repo: "kitn", ref: "v2", subdir: "templates/hono" });
  });

  test("github:user → throws", () => {
    expect(() => parseGitHubUrl("github:user")).toThrow("Expected github:owner/repo");
  });

  // --- Full URL format ---

  test("https://github.com/user/repo → defaults to main", () => {
    const ref = parseGitHubUrl("https://github.com/user/repo");
    expect(ref).toEqual({ owner: "user", repo: "repo", ref: "main", subdir: undefined });
  });

  test("https://github.com/user/repo/tree/branch/subdir → extracts all parts", () => {
    const ref = parseGitHubUrl("https://github.com/kitn-ai/kitn/tree/main/templates/hono");
    expect(ref).toEqual({ owner: "kitn-ai", repo: "kitn", ref: "main", subdir: "templates/hono" });
  });

  test("https://github.com/user/repo/tree/branch → no subdir", () => {
    const ref = parseGitHubUrl("https://github.com/user/repo/tree/develop");
    expect(ref).toEqual({ owner: "user", repo: "repo", ref: "develop", subdir: undefined });
  });

  test("non-github.com URL → throws", () => {
    expect(() => parseGitHubUrl("https://gitlab.com/user/repo")).toThrow("Only github.com");
  });

  test("invalid URL → throws", () => {
    expect(() => parseGitHubUrl("not-a-url")).toThrow("Invalid GitHub URL");
  });

  test("github.com with only owner → throws", () => {
    expect(() => parseGitHubUrl("https://github.com/user")).toThrow("Expected https://github.com/owner/repo");
  });
});
