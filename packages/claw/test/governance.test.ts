import { describe, test, expect } from "bun:test";
import { GovernanceManager, type GovernanceConfig } from "../src/governance/policies.js";

describe("GovernanceManager", () => {
  const config: GovernanceConfig = {
    actions: {
      "send-message": "draft",
      "post-public": "draft",
      "schedule": "draft",
      "delete": "blocked",
    },
  };

  test("draft actions return 'draft' decision", () => {
    const gm = new GovernanceManager(config);
    expect(gm.evaluate("send-message")).toBe("draft");
    expect(gm.evaluate("post-public")).toBe("draft");
  });

  test("blocked actions return 'deny'", () => {
    const gm = new GovernanceManager(config);
    expect(gm.evaluate("delete")).toBe("deny");
  });

  test("unlisted actions return 'pass' (defer to permission system)", () => {
    const gm = new GovernanceManager(config);
    expect(gm.evaluate("file-read")).toBe("pass");
    expect(gm.evaluate("bash")).toBe("pass");
  });

  test("auto actions return 'allow'", () => {
    const gm = new GovernanceManager({
      actions: { "send-message": "auto" },
    });
    expect(gm.evaluate("send-message")).toBe("allow");
  });

  test("user can override defaults", () => {
    const gm = new GovernanceManager({
      actions: {
        "post-public": "auto",
        "send-message": "blocked",
      },
    });
    expect(gm.evaluate("post-public")).toBe("allow");
    expect(gm.evaluate("send-message")).toBe("deny");
  });
});
