import { describe, test, expect } from "bun:test";
import {
  createBarrelFile,
  addImportToBarrel,
  removeImportFromBarrel,
  parseBarrelFile,
} from "../src/installers/barrel-manager.js";

describe("barrel-manager", () => {
  test("createBarrelFile generates initial barrel content", () => {
    const content = createBarrelFile();
    expect(content).toContain("export { registerWithPlugin }");
    expect(content).toContain("@kitnai/core");
  });

  test("addImportToBarrel adds import before export line", () => {
    const initial = createBarrelFile();
    const updated = addImportToBarrel(initial, "./agents/weather-agent.ts");
    expect(updated).toContain('import "./agents/weather-agent.ts"');
    // Import should be before the export
    const importIdx = updated.indexOf('import "./agents/weather-agent.ts"');
    const exportIdx = updated.indexOf("export {");
    expect(importIdx).toBeLessThan(exportIdx);
  });

  test("addImportToBarrel is idempotent", () => {
    const initial = createBarrelFile();
    const once = addImportToBarrel(initial, "./agents/weather-agent.ts");
    const twice = addImportToBarrel(once, "./agents/weather-agent.ts");
    expect(once).toBe(twice);
  });

  test("removeImportFromBarrel removes the import line", () => {
    const initial = createBarrelFile();
    const added = addImportToBarrel(initial, "./agents/weather-agent.ts");
    const removed = removeImportFromBarrel(added, "./agents/weather-agent.ts");
    expect(removed).not.toContain("weather-agent");
    expect(removed).toContain("export { registerWithPlugin }");
  });

  test("parseBarrelFile extracts import paths", () => {
    const content = [
      'import "./agents/weather-agent.ts";',
      'import "./tools/weather.ts";',
      'export { registerWithPlugin } from "@kitnai/core";',
    ].join("\n");
    const imports = parseBarrelFile(content);
    expect(imports).toEqual([
      "./agents/weather-agent.ts",
      "./tools/weather.ts",
    ]);
  });

  test("multiple imports maintain order", () => {
    let content = createBarrelFile();
    content = addImportToBarrel(content, "./agents/a.ts");
    content = addImportToBarrel(content, "./tools/b.ts");
    content = addImportToBarrel(content, "./agents/c.ts");
    const imports = parseBarrelFile(content);
    expect(imports).toEqual(["./agents/a.ts", "./tools/b.ts", "./agents/c.ts"]);
  });
});
