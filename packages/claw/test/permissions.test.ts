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

  describe("prefix collision prevention", () => {
    test("sandbox path does not match similar prefixes", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      // Should NOT match — different directory with shared prefix
      expect(
        pm.evaluate("file-write", { path: "/tmp/test-workspace2/malicious.txt" }),
      ).toBe("confirm");
      // Should match — actual file inside sandbox
      expect(
        pm.evaluate("file-write", { path: "/tmp/test-workspace/safe.txt" }),
      ).toBe("allow");
    });

    test("granted dir does not match similar prefixes", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: ["/home/user/Desktop"],
        sandbox: "/tmp/test-workspace",
      });
      // Should NOT match — different directory with shared prefix
      expect(
        pm.evaluate("file-write", { path: "/home/user/Desktop2/secret.txt" }),
      ).toBe("confirm");
      // Should match — actual file inside granted dir
      expect(
        pm.evaluate("file-write", { path: "/home/user/Desktop/file.txt" }),
      ).toBe("allow");
    });

    test("exact sandbox path match is allowed", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(
        pm.evaluate("file-write", { path: "/tmp/test-workspace" }),
      ).toBe("allow");
    });

    test("exact granted dir path match is allowed", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: ["/home/user/Desktop"],
        sandbox: "/tmp/test-workspace",
      });
      expect(
        pm.evaluate("file-write", { path: "/home/user/Desktop" }),
      ).toBe("allow");
    });
  });

  describe("firewall rules", () => {
    test("denyPatterns blocks matching command", () => {
      const pm = new PermissionManager({
        profile: "autonomous",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
        rules: {
          bash: {
            denyPatterns: ["^rm\\s+-rf", "sudo"],
          },
        },
      });
      expect(pm.evaluate("bash", { command: "rm -rf /" })).toBe("deny");
      expect(pm.evaluate("bash", { command: "sudo apt install" })).toBe("deny");
      expect(pm.evaluate("bash", { command: "ls -la" })).toBe("allow");
    });

    test("allowPatterns allows matching and denies non-matching", () => {
      const pm = new PermissionManager({
        profile: "autonomous",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
        rules: {
          bash: {
            allowPatterns: ["^ls", "^cat", "^echo"],
          },
        },
      });
      expect(pm.evaluate("bash", { command: "ls -la" })).toBe("allow");
      expect(pm.evaluate("bash", { command: "cat file.txt" })).toBe("allow");
      expect(pm.evaluate("bash", { command: "rm -rf /" })).toBe("deny");
    });

    test("denyPaths blocks matching paths", () => {
      const pm = new PermissionManager({
        profile: "autonomous",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
        rules: {
          "file-write": {
            denyPaths: ["/etc/", "/usr/"],
          },
        },
      });
      expect(pm.evaluate("file-write", { path: "/etc/passwd" })).toBe("deny");
      expect(pm.evaluate("file-write", { path: "/usr/local/bin/foo" })).toBe("deny");
      expect(pm.evaluate("file-write", { path: "/tmp/test-workspace/ok.txt" })).toBe("allow");
    });

    test("invalid regex pattern does not crash", () => {
      const pm = new PermissionManager({
        profile: "autonomous",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
        rules: {
          bash: {
            denyPatterns: ["[invalid(regex"],
            allowPatterns: ["[also(broken"],
          },
        },
      });
      // Should not throw — invalid patterns are silently skipped
      // With allowPatterns set but no match, result is "deny"
      expect(pm.evaluate("bash", { command: "ls" })).toBe("deny");
    });

    test("rule with both allowPatterns and allowPaths checks both", () => {
      const pm = new PermissionManager({
        profile: "autonomous",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
        rules: {
          bash: {
            allowPatterns: ["^ls"],
            allowPaths: ["/home/user/"],
          },
        },
      });
      // Command matches allowPatterns
      expect(pm.evaluate("bash", { command: "ls" })).toBe("allow");
      // Command doesn't match allowPatterns, but path matches allowPaths
      expect(pm.evaluate("bash", { command: "cat", path: "/home/user/file.txt" })).toBe("allow");
      // Neither matches
      expect(pm.evaluate("bash", { command: "rm", path: "/etc/passwd" })).toBe("deny");
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
