import { describe, test, expect } from "bun:test";
import { parseHeartbeat, type HeartbeatJob } from "../src/crons/heartbeat.js";

describe("parseHeartbeat", () => {
  test("every morning at 8am", () => {
    const content = `## Check the weather
Every morning at 8am, check the weather and send me a summary.
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe("0 8 * * *");
    expect(jobs[0].name).toBe("Check the weather");
    expect(jobs[0].prompt).toContain("check the weather");
  });

  test("every hour", () => {
    const content = `## Review my inbox
Every hour, scan my inbox for urgent emails.
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe("0 * * * *");
    expect(jobs[0].name).toBe("Review my inbox");
    expect(jobs[0].prompt).toContain("scan my inbox");
  });

  test("every day at 6pm", () => {
    const content = `## Daily summary
Every day at 6pm, compile the day's highlights.
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe("0 18 * * *");
    expect(jobs[0].name).toBe("Daily summary");
  });

  test("every Monday at 9am", () => {
    const content = `## Weekly report
Every Monday at 9am, compile a summary of last week's tasks.
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe("0 9 * * 1");
    expect(jobs[0].name).toBe("Weekly report");
  });

  test("every evening at 10pm", () => {
    const content = `## Nightly backup
Every evening at 10pm, back up important files.
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe("0 22 * * *");
    expect(jobs[0].name).toBe("Nightly backup");
  });

  test("every 3 hours", () => {
    const content = `## Check metrics
Every 3 hours, check system metrics and alert if anomalies.
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe("0 */3 * * *");
    expect(jobs[0].name).toBe("Check metrics");
  });

  test("every week / weekly", () => {
    const content = `## Cleanup
Every week, clean up old files.
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe("0 9 * * 1");
  });

  test("multiple sections parsed correctly", () => {
    const content = `## Check the weather
Every morning at 8am, check the weather and send me a summary.

## Review my inbox
Every hour, scan my inbox for urgent emails.

## Weekly report
Every Monday at 9am, compile a summary of last week's tasks.
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(3);
    expect(jobs[0].name).toBe("Check the weather");
    expect(jobs[0].schedule).toBe("0 8 * * *");
    expect(jobs[1].name).toBe("Review my inbox");
    expect(jobs[1].schedule).toBe("0 * * * *");
    expect(jobs[2].name).toBe("Weekly report");
    expect(jobs[2].schedule).toBe("0 9 * * 1");
  });

  test("non-schedule sections are ignored", () => {
    const content = `## Check the weather
Every morning at 8am, check the weather and send me a summary.

## Notes
These are just personal notes, not scheduled tasks.
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe("Check the weather");
  });

  test("sections with just text and no schedule keywords are skipped", () => {
    const content = `## My thoughts
I really should organize my desk sometime.

## Ideas
Build a better todo app.
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(0);
  });

  test("empty content returns empty array", () => {
    expect(parseHeartbeat("")).toHaveLength(0);
    expect(parseHeartbeat("   ")).toHaveLength(0);
  });

  test("heading with no body is skipped", () => {
    const content = `## Empty section
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(0);
  });

  test("every Saturday at 2pm", () => {
    const content = `## Weekend review
Every Saturday at 2pm, review the week.
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe("0 14 * * 6");
  });

  test("12am and 12pm edge cases", () => {
    const midnight = `## Midnight task
Every day at 12am, run midnight process.
`;
    const noon = `## Noon task
Every day at 12pm, run noon process.
`;
    const midnightJobs = parseHeartbeat(midnight);
    expect(midnightJobs[0].schedule).toBe("0 0 * * *");

    const noonJobs = parseHeartbeat(noon);
    expect(noonJobs[0].schedule).toBe("0 12 * * *");
  });

  test("prompt contains full section body without heading", () => {
    const content = `## Weather check
Every morning at 8am, check the weather forecast.
Include temperature and precipitation chance.
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].prompt).toContain("check the weather forecast");
    expect(jobs[0].prompt).toContain("Include temperature");
    expect(jobs[0].prompt).not.toContain("## Weather check");
  });
});
