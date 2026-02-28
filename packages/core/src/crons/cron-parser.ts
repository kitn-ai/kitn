/** Field ranges: [min, max] */
const FIELD_RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (0 and 7 = Sunday)
];

const FIELD_NAMES = ["minute", "hour", "day-of-month", "month", "day-of-week"];

function parseField(field: string, min: number, max: number): number[] | null {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    let range: string;
    let step = 1;

    if (stepMatch) {
      range = stepMatch[1];
      step = parseInt(stepMatch[2], 10);
      if (step < 1) return null;
    } else {
      range = part;
    }

    let start: number;
    let end: number;

    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      if (isNaN(a) || isNaN(b) || a < min || b > max || a > b) return null;
      start = a;
      end = b;
    } else {
      const v = parseInt(range, 10);
      if (isNaN(v) || v < min || v > max) return null;
      if (stepMatch) {
        start = v;
        end = max;
      } else {
        values.add(v);
        continue;
      }
    }

    for (let i = start; i <= end; i += step) {
      values.add(i);
    }
  }

  return values.size > 0 ? [...values].sort((a, b) => a - b) : null;
}

/** Validate a cron expression. Returns null if valid, error message if invalid. */
export function validateCron(expression: string): string | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return `Expected 5 fields, got ${fields.length}`;
  }

  for (let i = 0; i < 5; i++) {
    const [min, max] = FIELD_RANGES[i];
    const parsed = parseField(fields[i], min, max);
    if (parsed === null) {
      return `Invalid ${FIELD_NAMES[i]} field: "${fields[i]}"`;
    }
  }

  return null;
}

/** Parse a cron expression and compute the next run time after `after`. */
export function getNextRun(
  expression: string,
  after: Date,
  _timezone?: string,
): Date {
  const fields = expression.trim().split(/\s+/);
  const minutes = parseField(fields[0], 0, 59)!;
  const hours = parseField(fields[1], 0, 23)!;
  const daysOfMonth = parseField(fields[2], 1, 31)!;
  const months = parseField(fields[3], 1, 12)!;
  const daysOfWeek = parseField(fields[4], 0, 7)!.map((d) => d % 7); // normalize 7 -> 0

  // Start one minute after `after`
  const candidate = new Date(after);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  // Brute-force search (bounded to ~1 year to prevent infinite loops)
  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    const month = candidate.getUTCMonth() + 1; // 1-based
    const dom = candidate.getUTCDate();
    const dow = candidate.getUTCDay();
    const hour = candidate.getUTCHours();
    const minute = candidate.getUTCMinutes();

    if (
      months.includes(month) &&
      daysOfMonth.includes(dom) &&
      daysOfWeek.includes(dow) &&
      hours.includes(hour) &&
      minutes.includes(minute)
    ) {
      return candidate;
    }

    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  throw new Error(`Could not compute next run for: ${expression}`);
}
