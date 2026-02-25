import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { PackageManager } from "../utils/detect.js";

// Capture execSync calls by mocking child_process
const execSyncMock = mock();

mock.module("child_process", () => ({
  execSync: execSyncMock,
}));

// Import after mocking
const { installDependencies, installDevDependencies } = await import("./dep-installer.js");

describe("dep-installer", () => {
  beforeEach(() => {
    execSyncMock.mockClear();
  });

  describe("installDependencies", () => {
    it("does nothing for empty deps array", () => {
      installDependencies("bun", [], "/project");
      expect(execSyncMock).not.toHaveBeenCalled();
    });

    it("calls bun add for bun package manager", () => {
      installDependencies("bun", ["ai", "zod"], "/project");
      expect(execSyncMock).toHaveBeenCalledTimes(1);
      expect(execSyncMock.mock.calls[0][0]).toBe("bun add ai zod");
      expect(execSyncMock.mock.calls[0][1]).toEqual({ cwd: "/project", stdio: "pipe" });
    });

    it("calls pnpm add for pnpm package manager", () => {
      installDependencies("pnpm", ["ai"], "/project");
      expect(execSyncMock.mock.calls[0][0]).toBe("pnpm add ai");
    });

    it("calls yarn add for yarn package manager", () => {
      installDependencies("yarn", ["ai", "hono"], "/project");
      expect(execSyncMock.mock.calls[0][0]).toBe("yarn add ai hono");
    });

    it("calls npm install for npm package manager", () => {
      installDependencies("npm", ["ai"], "/project");
      expect(execSyncMock.mock.calls[0][0]).toBe("npm install ai");
    });

    it("passes project directory as cwd", () => {
      installDependencies("bun", ["ai"], "/my/project/dir");
      expect(execSyncMock.mock.calls[0][1].cwd).toBe("/my/project/dir");
    });
  });

  describe("installDevDependencies", () => {
    it("does nothing for empty deps array", () => {
      installDevDependencies("bun", [], "/project");
      expect(execSyncMock).not.toHaveBeenCalled();
    });

    it("calls bun add -d for bun package manager", () => {
      installDevDependencies("bun", ["typescript"], "/project");
      expect(execSyncMock.mock.calls[0][0]).toBe("bun add -d typescript");
    });

    it("calls pnpm add -D for pnpm package manager", () => {
      installDevDependencies("pnpm", ["typescript"], "/project");
      expect(execSyncMock.mock.calls[0][0]).toBe("pnpm add -D typescript");
    });

    it("calls yarn add -D for yarn package manager", () => {
      installDevDependencies("yarn", ["typescript"], "/project");
      expect(execSyncMock.mock.calls[0][0]).toBe("yarn add -D typescript");
    });

    it("calls npm install -D for npm package manager", () => {
      installDevDependencies("npm", ["typescript"], "/project");
      expect(execSyncMock.mock.calls[0][0]).toBe("npm install -D typescript");
    });
  });
});
