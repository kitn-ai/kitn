import type { LifecycleHookEmitter, LifecycleEventName, LifecycleEventMap } from "./lifecycle-hooks.js";
import type { RedactionConfig, RedactionPattern } from "../types.js";

/** Built-in redaction patterns. Each regex MUST use the `g` flag for replaceAll behavior. */
export const BUILTIN_PATTERNS: RedactionPattern[] = [
  {
    name: "apiKeys",
    regex: /\b(sk-|pk-|key-)[A-Za-z0-9_\-]{8,}\b|Bearer\s+\S+/g,
  },
  {
    name: "tokens",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b[0-9a-f]{32,}\b/g,
  },
  {
    name: "passwords",
    regex: /(?<=(password|secret|credential|passwd|pwd)\s*[:=]\s*)\S+/gi,
  },
  {
    name: "creditCards",
    regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,4}\b/g,
  },
  {
    name: "ssn",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    name: "emails",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  },
];

/**
 * Redact sensitive patterns from a string value.
 * Returns the original value unchanged if it's not a string.
 */
export function redactValue(value: unknown, patterns: RedactionPattern[]): unknown {
  if (typeof value !== "string") return value;

  let result = value;
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    const replacement = pattern.replacement ?? `[REDACTED:${pattern.name}]`;
    result = result.replace(pattern.regex, replacement);
  }
  return result;
}

/**
 * Deep-walk an object and redact all string values that match patterns.
 * Returns a new object (does not mutate the original).
 */
export function redactObject(
  obj: Record<string, unknown>,
  patterns: RedactionPattern[],
  skipFields?: Set<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (skipFields?.has(key)) {
      result[key] = value;
      continue;
    }

    if (typeof value === "string") {
      result[key] = redactValue(value, patterns);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string"
          ? redactValue(item, patterns)
          : item && typeof item === "object"
            ? redactObject(item as Record<string, unknown>, patterns, skipFields)
            : item,
      );
    } else if (value && typeof value === "object") {
      result[key] = redactObject(value as Record<string, unknown>, patterns, skipFields);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function resolvePatterns(config: RedactionConfig): RedactionPattern[] {
  const builtinNames = config.builtins;
  const builtins = builtinNames
    ? BUILTIN_PATTERNS.filter((p) => builtinNames.includes(p.name as any))
    : [...BUILTIN_PATTERNS];

  const custom = config.patterns ?? [];
  return [...builtins, ...custom];
}

/**
 * Wrap a LifecycleHookEmitter with secret redaction.
 * Event payloads are deep-walked and sensitive strings are replaced
 * before any handler fires.
 */
export function createRedactedHooks(
  inner: LifecycleHookEmitter,
  config: RedactionConfig,
): LifecycleHookEmitter {
  const patterns = resolvePatterns(config);
  const skipFields = config.skipFields ? new Set(config.skipFields) : undefined;

  return {
    on: inner.on.bind(inner),

    emit<E extends LifecycleEventName>(event: E, data: LifecycleEventMap[E]): void {
      const redacted = redactObject(
        data as unknown as Record<string, unknown>,
        patterns,
        skipFields,
      ) as unknown as LifecycleEventMap[E];
      inner.emit(event, redacted);
    },
  };
}
