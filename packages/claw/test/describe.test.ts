import { describe, test, expect } from "bun:test";
import { describeAction } from "../src/permissions/describe.js";

describe("describeAction", () => {
  test("describes file read", () => {
    const desc = describeAction("file-read", { path: "/home/user/notes.md" });
    expect(desc.summary.toLowerCase()).toContain("read");
    expect(desc.summary).toContain("notes.md");
    expect(desc.detail).toContain("/home/user/notes.md");
  });

  test("describes file write", () => {
    const desc = describeAction("file-write", {
      path: "/home/user/Desktop/report.txt",
      content: "Hello world",
    });
    expect(desc.summary.toLowerCase()).toContain("save");
    expect(desc.summary).toContain("Desktop");
    expect(desc.icon).toBe("📄");
  });

  test("describes bash command in plain language", () => {
    const desc = describeAction("bash", { command: "ls -la /home/user" });
    expect(desc.summary.toLowerCase()).toContain("run a command");
    expect(desc.detail).toContain("ls -la");
  });

  test("describes file delete as destructive", () => {
    const desc = describeAction("file-delete", { path: "/home/user/old.txt" });
    expect(desc.summary.toLowerCase()).toContain("delete");
    expect(desc.icon).toBe("🗑️");
    expect(desc.destructive).toBe(true);
  });

  test("describes web fetch", () => {
    const desc = describeAction("web-fetch", { url: "https://example.com" });
    expect(desc.summary.toLowerCase()).toContain("visit");
    expect(desc.detail).toContain("example.com");
  });

  test("describes unknown tool generically", () => {
    const desc = describeAction("custom-tool", { foo: "bar" });
    expect(desc.summary).toContain("custom-tool");
  });

  test("provides directory grant option for file writes", () => {
    const desc = describeAction("file-write", {
      path: "/home/user/Documents/report.pdf",
    });
    expect(desc.canGrantDir).toBe(true);
    expect(desc.grantDirLabel).toContain("Documents");
  });
});
