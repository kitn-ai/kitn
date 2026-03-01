import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

function describeCron(parts: string[]): string {
  const [min, hour, dom, mon, dow] = parts;
  const descs: string[] = [];
  if (min === "0" && hour === "*") descs.push("At the start of every hour");
  else if (min === "0" && hour !== "*") descs.push(`At ${hour}:00`);
  else if (min !== "*" && hour !== "*") descs.push(`At ${hour}:${min.padStart(2, "0")}`);
  else if (min !== "*") descs.push(`At minute ${min} of every hour`);
  else descs.push("Every minute");
  if (dom !== "*") descs.push(`on day ${dom} of the month`);
  if (mon !== "*") descs.push(`in month ${mon}`);
  if (dow !== "*") {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayNames = dow.split(",").map((d) => days[parseInt(d)] ?? d).join(", ");
    descs.push(`on ${dayNames}`);
  }
  return descs.join(" ");
}

function getNextRuns(expr: string, count: number, from: Date): string[] {
  // Simple next-run computation for standard 5-field cron
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return ["Invalid cron expression — expected 5 fields"];
  const runs: string[] = [];
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const maxIterations = 525960; // ~1 year of minutes
  for (let i = 0; i < maxIterations && runs.length < count; i++) {
    if (matches(parts, d)) runs.push(d.toISOString());
    d.setMinutes(d.getMinutes() + 1);
  }
  return runs;
}

function matches(parts: string[], d: Date): boolean {
  const [min, hour, dom, mon, dow] = parts;
  return matchField(min, d.getMinutes()) && matchField(hour, d.getHours()) && matchField(dom, d.getDate()) && matchField(mon, d.getMonth() + 1) && matchField(dow, d.getDay());
}

function matchField(field: string, value: number): boolean {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    if (part.includes("/")) { const [range, step] = part.split("/"); const s = parseInt(step); const start = range === "*" ? 0 : parseInt(range); return (value - start) % s === 0 && value >= start; }
    if (part.includes("-")) { const [a, b] = part.split("-").map(Number); return value >= a && value <= b; }
    return parseInt(part) === value;
  });
}

export const cronParserTool = tool({
  description: "Parse a cron expression: validate syntax, show next run times, and describe in human-readable form",
  inputSchema: z.object({
    expression: z.string().describe("Cron expression (5 fields: min hour dom mon dow)"),
    nextCount: z.number().min(1).max(20).default(5).describe("Number of next run times to compute"),
  }),
  execute: async ({ expression, nextCount }) => {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) return { valid: false, error: "Expected 5 fields: minute hour day-of-month month day-of-week" };
    return { valid: true, expression, description: describeCron(parts), nextRuns: getNextRuns(expression, nextCount, new Date()) };
  },
});

registerTool({
  name: "cron-parser",
  description: "Parse a cron expression: validate syntax, show next run times, and describe in human-readable form",
  inputSchema: z.object({ expression: z.string(), nextCount: z.number().min(1).max(20).default(5) }),
  tool: cronParserTool,
});
