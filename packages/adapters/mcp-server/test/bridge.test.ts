import { describe, test, expect } from "bun:test";
import { toolResultToMCP, toolErrorToMCP } from "../src/bridge.js";

describe("toolResultToMCP", () => {
  test("string result → text content", () => {
    const result = toolResultToMCP("hello");
    expect(result).toEqual({
      content: [{ type: "text", text: "hello" }],
    });
  });

  test("object result → JSON text content", () => {
    const result = toolResultToMCP({ key: "value", count: 42 });
    expect(result).toEqual({
      content: [{ type: "text", text: '{"key":"value","count":42}' }],
    });
  });

  test("number result → text content", () => {
    const result = toolResultToMCP(42);
    expect(result).toEqual({
      content: [{ type: "text", text: "42" }],
    });
  });

  test("null result → text content", () => {
    const result = toolResultToMCP(null);
    expect(result).toEqual({
      content: [{ type: "text", text: "null" }],
    });
  });

  test("array result → JSON text content", () => {
    const result = toolResultToMCP([1, 2, 3]);
    expect(result).toEqual({
      content: [{ type: "text", text: "[1,2,3]" }],
    });
  });

  test("boolean result → text content", () => {
    const result = toolResultToMCP(true);
    expect(result).toEqual({
      content: [{ type: "text", text: "true" }],
    });
  });
});

describe("toolErrorToMCP", () => {
  test("Error instance → isError + message", () => {
    const result = toolErrorToMCP(new Error("something went wrong"));
    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "something went wrong" }],
    });
  });

  test("string error → isError + message", () => {
    const result = toolErrorToMCP("plain error string");
    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "plain error string" }],
    });
  });

  test("number error → isError + stringified", () => {
    const result = toolErrorToMCP(404);
    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "404" }],
    });
  });
});
