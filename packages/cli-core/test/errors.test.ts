import { describe, test, expect } from "bun:test";
import { NotInitializedError } from "../src/errors.js";

describe("NotInitializedError", () => {
  test("is an instance of Error", () => {
    const err = new NotInitializedError("/tmp/my-project");
    expect(err).toBeInstanceOf(Error);
  });

  test("has code NOT_INITIALIZED", () => {
    const err = new NotInitializedError("/tmp/my-project");
    expect(err.code).toBe("NOT_INITIALIZED");
  });

  test("stores the cwd", () => {
    const err = new NotInitializedError("/tmp/my-project");
    expect(err.cwd).toBe("/tmp/my-project");
  });

  test("message includes the cwd", () => {
    const err = new NotInitializedError("/tmp/my-project");
    expect(err.message).toContain("/tmp/my-project");
  });

  test("has name NotInitializedError", () => {
    const err = new NotInitializedError("/tmp/my-project");
    expect(err.name).toBe("NotInitializedError");
  });
});
