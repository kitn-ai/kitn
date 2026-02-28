/** Convert a kitn tool execution result to MCP CallToolResult format. */
export function toolResultToMCP(result: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  return { content: [{ type: "text" as const, text }] };
}

/** Convert an error to MCP error CallToolResult format. */
export function toolErrorToMCP(error: unknown): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
