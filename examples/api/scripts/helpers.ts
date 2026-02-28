/**
 * Shared test helpers for kitn API scripts.
 * Each script imports { api, assert, summary, header } from "./helpers.ts"
 */
import pc from "picocolors";

const BASE_URL = process.env.KITN_BASE_URL ?? "http://localhost:4000";
const API_KEY = process.env.KITN_API_KEY ?? "demo";

let _pass = 0;
let _fail = 0;
let _skip = 0;

export interface ApiResult {
  status: number;
  body: string;
  json: () => any;
}

/** Print a section header. */
export function header(title: string) {
  console.log();
  console.log(pc.bold(pc.cyan(`=== ${title} ===`)));
  console.log();
}

/** Print an info line. */
export function info(msg: string) {
  console.log(pc.dim(`  ${msg}`));
}

/** Make an API call. */
export async function api(
  method: string,
  path: string,
  body?: unknown,
  opts?: { headers?: Record<string, string>; skipAuth?: boolean },
): Promise<ApiResult> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts?.headers,
  };
  if (!opts?.skipAuth) {
    headers["X-API-Key"] = API_KEY;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  return {
    status: res.status,
    body: text,
    json: () => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
  };
}

/** Assert helpers that track pass/fail counts. */
export const assert = {
  status(res: ApiResult, expected: number, label?: string) {
    if (res.status === expected) {
      console.log(`  ${pc.green("PASS")} ${label ?? ""} ${pc.dim(`(HTTP ${res.status})`)}`);
      _pass++;
    } else {
      console.log(`  ${pc.red("FAIL")} ${label ?? ""} — expected HTTP ${expected}, got ${res.status}`);
      console.log(`  ${pc.dim(res.body.slice(0, 200))}`);
      _fail++;
    }
  },

  contains(res: ApiResult, needle: string, label?: string) {
    if (res.body.includes(needle)) {
      console.log(`  ${pc.green("PASS")} ${label ?? ""} ${pc.dim(`— contains "${needle}"`)}`);
      _pass++;
    } else {
      console.log(`  ${pc.red("FAIL")} ${label ?? ""} — missing "${needle}"`);
      console.log(`  ${pc.dim(res.body.slice(0, 200))}`);
      _fail++;
    }
  },

  notContains(res: ApiResult, needle: string, label?: string) {
    if (!res.body.includes(needle)) {
      console.log(`  ${pc.green("PASS")} ${label ?? ""} ${pc.dim(`— does not contain "${needle}"`)}`);
      _pass++;
    } else {
      console.log(`  ${pc.red("FAIL")} ${label ?? ""} — should not contain "${needle}"`);
      console.log(`  ${pc.dim(res.body.slice(0, 200))}`);
      _fail++;
    }
  },

  ok(condition: boolean, label?: string) {
    if (condition) {
      console.log(`  ${pc.green("PASS")} ${label ?? ""}`);
      _pass++;
    } else {
      console.log(`  ${pc.red("FAIL")} ${label ?? ""}`);
      _fail++;
    }
  },

  skip(label: string) {
    console.log(`  ${pc.yellow("SKIP")} ${label}`);
    _skip++;
  },
};

/** Print pass/fail summary. Returns the fail count (0 = success). */
export function summary(): number {
  console.log();
  const total = _pass + _fail + _skip;
  if (_fail === 0) {
    console.log(pc.green(pc.bold(`All ${_pass} tests passed.`)) + (_skip ? pc.dim(` (${_skip} skipped)`) : ""));
  } else {
    console.log(
      pc.bold(`${pc.green(`${_pass} passed`)}, ${pc.red(`${_fail} failed`)}`) +
        (_skip ? pc.dim(`, ${_skip} skipped`) : "") +
        pc.dim(` (${total} total)`),
    );
  }
  console.log();
  return _fail;
}

/** Reset counters (used by runner when executing multiple scripts). */
export function resetCounters() {
  _pass = 0;
  _fail = 0;
  _skip = 0;
}

export function getCounts() {
  return { pass: _pass, fail: _fail, skip: _skip };
}
