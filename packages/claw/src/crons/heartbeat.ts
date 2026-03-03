/**
 * Parser for HEARTBEAT.md — converts natural-language schedules
 * into cron job definitions.
 *
 * Format:
 * ```markdown
 * ## Job Name
 * Every morning at 8am, do something useful.
 *
 * ## Another Job
 * Every hour, check something.
 * ```
 *
 * Sections without recognizable schedule patterns are skipped.
 */

export interface HeartbeatJob {
  name: string;
  schedule: string; // cron expression
  prompt: string; // the instruction text
}

const DAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const DAY_NAMES = Object.keys(DAY_MAP).join("|");

/**
 * Convert a 12-hour time like "8am" or "6pm" to 24-hour hour number.
 */
function parseHour(hourStr: string, period: string): number {
  let hour = parseInt(hourStr, 10);
  const p = period.toLowerCase();
  if (p === "pm" && hour !== 12) hour += 12;
  if (p === "am" && hour === 12) hour = 0;
  return hour;
}

/**
 * Try to extract a cron schedule from a block of text.
 * Returns null if no recognizable pattern is found.
 */
function extractSchedule(text: string): string | null {
  const lower = text.toLowerCase();

  // "every X hours"
  const everyXHours = lower.match(/every\s+(\d+)\s+hours?/);
  if (everyXHours) {
    const hours = parseInt(everyXHours[1], 10);
    return `0 */${hours} * * *`;
  }

  // "every hour"
  if (/every\s+hour\b/.test(lower)) {
    return "0 * * * *";
  }

  // "every (weekday) at Xam/pm"
  const weekdayAt = lower.match(
    new RegExp(
      `every\\s+(${DAY_NAMES})\\s+at\\s+(\\d{1,2})\\s*(am|pm)`,
    ),
  );
  if (weekdayAt) {
    const day = DAY_MAP[weekdayAt[1]];
    const hour = parseHour(weekdayAt[2], weekdayAt[3]);
    return `0 ${hour} * * ${day}`;
  }

  // "every morning at Xam/pm"
  const morningAt = lower.match(/every\s+morning\s+at\s+(\d{1,2})\s*(am|pm)/);
  if (morningAt) {
    const hour = parseHour(morningAt[1], morningAt[2]);
    return `0 ${hour} * * *`;
  }

  // "every evening at Xam/pm"
  const eveningAt = lower.match(/every\s+evening\s+at\s+(\d{1,2})\s*(am|pm)/);
  if (eveningAt) {
    const hour = parseHour(eveningAt[1], eveningAt[2]);
    return `0 ${hour} * * *`;
  }

  // "every day at Xam/pm"
  const dayAt = lower.match(/every\s+day\s+at\s+(\d{1,2})\s*(am|pm)/);
  if (dayAt) {
    const hour = parseHour(dayAt[1], dayAt[2]);
    return `0 ${hour} * * *`;
  }

  // "every week" / "weekly" — default Monday 9am
  if (/every\s+week\b/.test(lower) || /\bweekly\b/.test(lower)) {
    return "0 9 * * 1";
  }

  return null;
}

/**
 * Parse a HEARTBEAT.md file into an array of HeartbeatJob definitions.
 *
 * Sections are delimited by `## ` headings. Each section's heading
 * becomes the job name. The body text is scanned for natural-language
 * schedule patterns and becomes the prompt. Sections without a
 * recognizable schedule are silently skipped.
 */
export function parseHeartbeat(content: string): HeartbeatJob[] {
  const jobs: HeartbeatJob[] = [];

  // Split on ## headings, keeping the heading text
  const sections = content.split(/^## /m).filter((s) => s.trim());

  for (const section of sections) {
    const newlineIdx = section.indexOf("\n");
    if (newlineIdx === -1) continue;

    const name = section.slice(0, newlineIdx).trim();
    const body = section.slice(newlineIdx + 1).trim();

    if (!name || !body) continue;

    const schedule = extractSchedule(body);
    if (!schedule) continue;

    jobs.push({
      name,
      schedule,
      prompt: body,
    });
  }

  return jobs;
}
