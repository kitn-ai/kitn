import { describe, test, expect } from "bun:test";
import { PermissionManager } from "../src/permissions/manager.js";

describe("PermissionManager", () => {
  describe("safety profiles", () => {
    test("balanced profile auto-allows reads", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-read", { path: "/any/path" })).toBe("allow");
    });

    test("balanced profile auto-allows writes in sandbox", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-write", { path: "/tmp/test-workspace/notes.md" })).toBe("allow");
    });

    test("balanced profile asks for writes outside sandbox", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-write", { path: "/home/user/Desktop/file.txt" })).toBe("confirm");
    });

    test("balanced profile auto-allows writes in granted dirs", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: ["/home/user/Documents"],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-write", { path: "/home/user/Documents/notes.md" })).toBe("allow");
    });

    test("balanced profile asks for shell commands", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("bash", { command: "ls" })).toBe("confirm");
    });

    test("balanced profile auto-allows web search", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("web-search", {})).toBe("allow");
    });

    test("cautious profile asks for everything except memory", () => {
      const pm = new PermissionManager({
        profile: "cautious",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-read", { path: "/tmp/a" })).toBe("confirm");
      expect(pm.evaluate("web-search", {})).toBe("confirm");
      expect(pm.evaluate("memory-save", {})).toBe("allow");
      expect(pm.evaluate("memory-search", {})).toBe("allow");
    });

    test("autonomous profile auto-allows most things", () => {
      const pm = new PermissionManager({
        profile: "autonomous",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-write", { path: "/anywhere/file.txt" })).toBe("allow");
      expect(pm.evaluate("bash", { command: "ls" })).toBe("allow");
      expect(pm.evaluate("web-search", {})).toBe("allow");
    });

    test("all profiles always ask for deletes", () => {
      for (const profile of ["cautious", "balanced", "autonomous"] as const) {
        const pm = new PermissionManager({
          profile,
          grantedDirs: [],
          sandbox: "/tmp/test-workspace",
        });
        expect(pm.evaluate("file-delete", { path: "/tmp/file" })).toBe("confirm");
      }
    });

    test("all profiles always ask for send-message", () => {
      for (const profile of ["cautious", "balanced", "autonomous"] as const) {
        const pm = new PermissionManager({
          profile,
          grantedDirs: [],
          sandbox: "/tmp/test-workspace",
        });
        expect(pm.evaluate("send-message", {})).toBe("confirm");
      }
    });
  });

  describe("progressive trust", () => {
    test("granting a directory remembers it", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-write", { path: "/home/user/Desktop/a.txt" })).toBe("confirm");

      pm.grantDirectory("/home/user/Desktop");

      expect(pm.evaluate("file-write", { path: "/home/user/Desktop/a.txt" })).toBe("allow");
      expect(pm.evaluate("file-write", { path: "/home/user/Desktop/sub/b.txt" })).toBe("allow");
    });

    test("session trust works for non-file tools", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("bash", { command: "ls" })).toBe("confirm");

      pm.trustForSession("bash");

      expect(pm.evaluate("bash", { command: "ls" })).toBe("allow");
    });

    test("session trust does not affect always-ask tools", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      pm.trustForSession("file-delete");
      expect(pm.evaluate("file-delete", { path: "/tmp/x" })).toBe("confirm");
    });
  });

  describe("explicit deny list (backward compat)", () => {
    test("denied tools are always denied", () => {
      const pm = new PermissionManager({
        profile: "autonomous",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
        denied: ["bash"],
      });
      expect(pm.evaluate("bash", { command: "ls" })).toBe("deny");
    });
  });
});
