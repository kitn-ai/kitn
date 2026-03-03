import { describe, test, expect } from "bun:test";
import { PermissionManager } from "../src/permissions/manager.js";

describe("PermissionManager", () => {
  test("safe tools auto-execute", () => {
    const pm = new PermissionManager({ trusted: [], requireConfirmation: [], denied: [] });
    expect(pm.check("file-read")).toBe("allow");
    expect(pm.check("web-fetch")).toBe("allow");
    expect(pm.check("memory-search")).toBe("allow");
  });

  test("dangerous tools require confirmation", () => {
    const pm = new PermissionManager({ trusted: [], requireConfirmation: [], denied: [] });
    expect(pm.check("bash")).toBe("confirm");
    expect(pm.check("send-message")).toBe("confirm");
    expect(pm.check("file-delete")).toBe("confirm");
  });

  test("moderate tools require confirmation", () => {
    const pm = new PermissionManager({ trusted: [], requireConfirmation: [], denied: [] });
    expect(pm.check("file-write")).toBe("confirm");
    expect(pm.check("create-tool")).toBe("confirm");
  });

  test("unknown tools default to moderate (confirm)", () => {
    const pm = new PermissionManager({ trusted: [], requireConfirmation: [], denied: [] });
    expect(pm.check("some-unknown-tool")).toBe("confirm");
  });

  test("trusted list overrides category", () => {
    const pm = new PermissionManager({ trusted: ["bash"], requireConfirmation: [], denied: [] });
    expect(pm.check("bash")).toBe("allow");
  });

  test("denied list blocks execution", () => {
    const pm = new PermissionManager({ trusted: [], requireConfirmation: [], denied: ["bash"] });
    expect(pm.check("bash")).toBe("deny");
  });

  test("denied takes priority over trusted", () => {
    const pm = new PermissionManager({ trusted: ["bash"], requireConfirmation: [], denied: ["bash"] });
    expect(pm.check("bash")).toBe("deny");
  });

  test("requireConfirmation list forces confirm even for safe tools", () => {
    const pm = new PermissionManager({ trusted: [], requireConfirmation: ["file-read"], denied: [] });
    expect(pm.check("file-read")).toBe("confirm");
  });

  test("session trust persists within session", () => {
    const pm = new PermissionManager({ trusted: [], requireConfirmation: [], denied: [] });
    pm.trustForSession("file-write");
    expect(pm.check("file-write")).toBe("allow");
  });

  test("clearSessionTrust resets session trust", () => {
    const pm = new PermissionManager({ trusted: [], requireConfirmation: [], denied: [] });
    pm.trustForSession("file-write");
    expect(pm.check("file-write")).toBe("allow");
    pm.clearSessionTrust();
    expect(pm.check("file-write")).toBe("confirm");
  });
});
