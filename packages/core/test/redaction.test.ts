import { describe, test, expect, mock } from "bun:test";
import { createRedactedHooks, BUILTIN_PATTERNS, redactValue, redactObject } from "../src/hooks/redaction.js";
import { createLifecycleHooks } from "../src/hooks/lifecycle-hooks.js";


describe("redactValue", () => {
  test("redacts sk- prefixed API keys", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "apiKeys");
    expect(redactValue("my key is sk-abc123def456", patterns)).toBe("my key is [REDACTED:apiKeys]");
  });

  test("redacts Bearer tokens", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "apiKeys");
    expect(redactValue("Bearer eyJhbGciOiJIUzI1NiJ9.test.sig", patterns)).toBe("[REDACTED:apiKeys]");
  });

  test("redacts JWTs", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "tokens");
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactValue(jwt, patterns)).toContain("[REDACTED:tokens]");
  });

  test("redacts long hex tokens", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "tokens");
    const hex = "a".repeat(40);
    expect(redactValue(`token: ${hex}`, patterns)).toContain("[REDACTED:tokens]");
  });

  test("redacts SSNs", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "ssn");
    expect(redactValue("SSN: 123-45-6789", patterns)).toBe("SSN: [REDACTED:ssn]");
  });

  test("redacts emails", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "emails");
    expect(redactValue("contact user@example.com please", patterns)).toContain("[REDACTED:emails]");
  });

  test("redacts credit card numbers", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "creditCards");
    expect(redactValue("card: 4111 1111 1111 1111", patterns)).toBe("card: [REDACTED:creditCards]");
    expect(redactValue("card: 4111-1111-1111-1111", patterns)).toBe("card: [REDACTED:creditCards]");
  });

  test("redacts password values", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "passwords");
    expect(redactValue("password: mysecret123", patterns)).toBe("password: [REDACTED:passwords]");
    expect(redactValue("secret=topsecret", patterns)).toBe("secret=[REDACTED:passwords]");
  });

  test("returns non-string values unchanged", () => {
    const patterns = BUILTIN_PATTERNS;
    expect(redactValue(42 as any, patterns)).toBe(42);
    expect(redactValue(true as any, patterns)).toBe(true);
    expect(redactValue(null as any, patterns)).toBe(null);
  });
});

describe("redactObject", () => {
  test("deep-walks nested objects", () => {
    const obj = {
      outer: { inner: "key is sk-secret123" },
      safe: 42,
    };
    const result = redactObject(obj, BUILTIN_PATTERNS);
    expect((result as any).outer.inner).toContain("[REDACTED:apiKeys]");
    expect((result as any).safe).toBe(42);
  });

  test("handles arrays", () => {
    const obj = { items: ["sk-key1longvalue", "safe", "sk-key2longvalue"] };
    const result = redactObject(obj, BUILTIN_PATTERNS);
    expect((result as any).items[0]).toContain("[REDACTED:apiKeys]");
    expect((result as any).items[1]).toBe("safe");
    expect((result as any).items[2]).toContain("[REDACTED:apiKeys]");
  });

  test("skips specified fields", () => {
    const obj = { agentName: "sk-not-a-real-key", input: "sk-real-key" };
    const result = redactObject(obj, BUILTIN_PATTERNS, new Set(["agentName"]));
    expect((result as any).agentName).toBe("sk-not-a-real-key");
    expect((result as any).input).toContain("[REDACTED:apiKeys]");
  });
});

describe("createRedactedHooks", () => {
  test("wraps emitter and redacts event payloads", () => {
    const inner = createLifecycleHooks({ level: "trace" });
    const redacted = createRedactedHooks(inner, {});

    const received: any[] = [];
    redacted.on("agent:start", (data) => received.push(data));

    redacted.emit("agent:start", {
      agentName: "test",
      conversationId: "conv-1",
      input: "Use key sk-mysecretkey123",
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].input).toContain("[REDACTED:apiKeys]");
    expect(received[0].agentName).toBe("test");
  });

  test("passes through when no patterns match", () => {
    const inner = createLifecycleHooks({ level: "trace" });
    const redacted = createRedactedHooks(inner, {});

    const received: any[] = [];
    redacted.on("agent:start", (data) => received.push(data));

    redacted.emit("agent:start", {
      agentName: "test",
      conversationId: "conv-1",
      input: "Hello, how are you?",
      timestamp: Date.now(),
    });

    expect(received[0].input).toBe("Hello, how are you?");
  });

  test("respects builtins filter -- only redacts selected patterns", () => {
    const inner = createLifecycleHooks({ level: "trace" });
    const redacted = createRedactedHooks(inner, { builtins: ["ssn"] });

    const received: any[] = [];
    redacted.on("agent:start", (data) => received.push(data));

    redacted.emit("agent:start", {
      agentName: "test",
      conversationId: "conv-1",
      input: "key sk-abc123 and ssn 123-45-6789",
      timestamp: Date.now(),
    });

    expect(received[0].input).toContain("sk-abc123"); // NOT redacted
    expect(received[0].input).toContain("[REDACTED:ssn]");
  });

  test("supports custom patterns", () => {
    const inner = createLifecycleHooks({ level: "trace" });
    const redacted = createRedactedHooks(inner, {
      patterns: [{ name: "customId", regex: /CUST-\d{6}/g }],
    });

    const received: any[] = [];
    redacted.on("agent:start", (data) => received.push(data));

    redacted.emit("agent:start", {
      agentName: "test",
      conversationId: "conv-1",
      input: "Customer CUST-123456",
      timestamp: Date.now(),
    });

    expect(received[0].input).toContain("[REDACTED:customId]");
  });
});
