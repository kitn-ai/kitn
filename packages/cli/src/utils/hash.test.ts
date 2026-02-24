import { describe, it, expect } from "bun:test";
import { contentHash } from "./hash.js";

describe("contentHash", () => {
  it("produces consistent hash for same content", () => {
    const h1 = contentHash("hello world");
    const h2 = contentHash("hello world");
    expect(h1).toBe(h2);
  });

  it("produces different hash for different content", () => {
    const h1 = contentHash("hello");
    const h2 = contentHash("world");
    expect(h1).not.toBe(h2);
  });

  it("returns an 8-character hex string", () => {
    const hash = contentHash("test");
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });
});
