/** Well-known tool names used by the framework */
export const TOOL_NAMES = {
  ROUTE_TO_AGENT: "routeToAgent",
  CREATE_TASK: "createTask",
  CLARIFY: "clarify",
  MEMORY: "memory",
} as const;

/** Default configuration values */
export const DEFAULTS = {
  MAX_DELEGATION_DEPTH: 3,
  MAX_STEPS: 5,
  SYNTHESIS_MESSAGE: "Synthesizing results...",
  RESPONSE_SKILLS_KEY: "_responseSkills",
  COMPACTION_THRESHOLD: 20,
  COMPACTION_PRESERVE_RECENT: 4,
  SUMMARY_LENGTH_LIMIT: 200,
} as const;
