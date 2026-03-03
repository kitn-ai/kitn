import { describe, test, expect } from "bun:test";
import { UserManager } from "../src/users/manager.js";
import type { UserConfig, UserRole } from "../src/users/manager.js";

describe("UserManager", () => {
  describe("user resolution", () => {
    test("resolves known user by userId", () => {
      const manager = new UserManager({
        alice: { role: "operator" },
        bob: { role: "user" },
      });
      const alice = manager.getUser("alice");
      expect(alice.role).toBe("operator");

      const bob = manager.getUser("bob");
      expect(bob.role).toBe("user");
    });

    test("returns role and settings for registered user", () => {
      const manager = new UserManager({
        carol: {
          role: "user",
          channels: ["terminal", "http"],
          denied: ["web-search"],
        },
      });
      const carol = manager.getUser("carol");
      expect(carol.role).toBe("user");
      expect(carol.channels).toEqual(["terminal", "http"]);
      expect(carol.denied).toEqual(["web-search"]);
    });

    test("unknown userId defaults to guest", () => {
      const manager = new UserManager({
        alice: { role: "operator" },
      });
      const unknown = manager.getUser("stranger");
      expect(unknown.role).toBe("guest");
    });

    test("unknown userId defaults to custom defaultRole", () => {
      const manager = new UserManager(
        { alice: { role: "operator" } },
        "user",
      );
      const unknown = manager.getUser("stranger");
      expect(unknown.role).toBe("user");
    });
  });

  describe("three roles", () => {
    test("operator has full access role", () => {
      const manager = new UserManager({
        admin: { role: "operator" },
      });
      expect(manager.getUser("admin").role).toBe("operator");
    });

    test("user has standard role", () => {
      const manager = new UserManager({
        member: { role: "user" },
      });
      expect(manager.getUser("member").role).toBe("user");
    });

    test("guest has limited role", () => {
      const manager = new UserManager({
        visitor: { role: "guest" },
      });
      expect(manager.getUser("visitor").role).toBe("guest");
    });
  });

  describe("channel access", () => {
    const manager = new UserManager({
      admin: { role: "operator" },
      member: { role: "user", channels: ["terminal", "http"] },
      visitor: { role: "guest", channels: ["telegram"] },
      unrestricted: { role: "user" },
    });

    test("operator can access all channels", () => {
      expect(manager.canAccessChannel("admin", "terminal")).toBe(true);
      expect(manager.canAccessChannel("admin", "discord")).toBe(true);
      expect(manager.canAccessChannel("admin", "telegram")).toBe(true);
      expect(manager.canAccessChannel("admin", "http")).toBe(true);
      expect(manager.canAccessChannel("admin", "websocket")).toBe(true);
    });

    test("user can access allowed channels", () => {
      expect(manager.canAccessChannel("member", "terminal")).toBe(true);
      expect(manager.canAccessChannel("member", "http")).toBe(true);
    });

    test("user cannot access disallowed channels", () => {
      expect(manager.canAccessChannel("member", "discord")).toBe(false);
      expect(manager.canAccessChannel("member", "telegram")).toBe(false);
    });

    test("guest only gets specific channels", () => {
      expect(manager.canAccessChannel("visitor", "telegram")).toBe(true);
      expect(manager.canAccessChannel("visitor", "terminal")).toBe(false);
      expect(manager.canAccessChannel("visitor", "http")).toBe(false);
    });

    test("user with no channel restrictions can access all", () => {
      expect(manager.canAccessChannel("unrestricted", "terminal")).toBe(true);
      expect(manager.canAccessChannel("unrestricted", "discord")).toBe(true);
      expect(manager.canAccessChannel("unrestricted", "telegram")).toBe(true);
    });

    test("unknown user (guest) with no channels gets unrestricted channel access", () => {
      // Default guest has no channel restrictions defined
      expect(manager.canAccessChannel("stranger", "terminal")).toBe(true);
      expect(manager.canAccessChannel("stranger", "http")).toBe(true);
    });
  });

  describe("tool overrides", () => {
    test("operator has no denied tools by default", () => {
      const manager = new UserManager({
        admin: { role: "operator" },
      });
      expect(manager.getDeniedTools("admin")).toEqual([]);
    });

    test("user has no denied tools by default", () => {
      const manager = new UserManager({
        member: { role: "user" },
      });
      expect(manager.getDeniedTools("member")).toEqual([]);
    });

    test("guest has default denied tools", () => {
      const manager = new UserManager({
        visitor: { role: "guest" },
      });
      const denied = manager.getDeniedTools("visitor");
      expect(denied).toContain("bash");
      expect(denied).toContain("file-write");
      expect(denied).toContain("file-delete");
      expect(denied).toContain("create-tool");
      expect(denied).toContain("create-agent");
    });

    test("user-specific denied tools merge with role defaults", () => {
      const manager = new UserManager({
        restricted: { role: "user", denied: ["bash", "web-fetch"] },
      });
      const denied = manager.getDeniedTools("restricted");
      expect(denied).toContain("bash");
      expect(denied).toContain("web-fetch");
    });

    test("guest user-specific denied tools merge with role defaults (no duplicates)", () => {
      const manager = new UserManager({
        extra: { role: "guest", denied: ["bash", "web-search"] },
      });
      const denied = manager.getDeniedTools("extra");
      // "bash" appears in both role defaults and user-specific, should be deduplicated
      const bashCount = denied.filter((t) => t === "bash").length;
      expect(bashCount).toBe(1);
      // "web-search" is user-specific only
      expect(denied).toContain("web-search");
      // Still has other role defaults
      expect(denied).toContain("file-write");
      expect(denied).toContain("file-delete");
    });

    test("operator with user-specific denied tools respects overrides", () => {
      const manager = new UserManager({
        limited_admin: { role: "operator", denied: ["web-fetch"] },
      });
      const denied = manager.getDeniedTools("limited_admin");
      expect(denied).toEqual(["web-fetch"]);
    });

    test("unknown user gets guest denied tools", () => {
      const manager = new UserManager({});
      const denied = manager.getDeniedTools("nobody");
      expect(denied).toContain("bash");
      expect(denied).toContain("file-write");
      expect(denied).toContain("file-delete");
      expect(denied).toContain("create-tool");
      expect(denied).toContain("create-agent");
    });
  });

  describe("config-based user registration", () => {
    test("creates manager from config-style record", () => {
      const usersConfig: Record<string, UserConfig> = {
        owner: { role: "operator" },
        family: { role: "user", channels: ["terminal", "discord"] },
        public: { role: "guest", channels: ["telegram"] },
      };
      const manager = new UserManager(usersConfig);

      expect(manager.getUser("owner").role).toBe("operator");
      expect(manager.getUser("family").role).toBe("user");
      expect(manager.getUser("family").channels).toEqual(["terminal", "discord"]);
      expect(manager.getUser("public").role).toBe("guest");
      expect(manager.canAccessChannel("owner", "telegram")).toBe(true);
      expect(manager.canAccessChannel("family", "telegram")).toBe(false);
      expect(manager.canAccessChannel("public", "telegram")).toBe(true);
      expect(manager.canAccessChannel("public", "terminal")).toBe(false);
    });

    test("empty users config still works", () => {
      const manager = new UserManager({});
      expect(manager.getUser("anyone").role).toBe("guest");
      expect(manager.canAccessChannel("anyone", "terminal")).toBe(true);
    });
  });
});
