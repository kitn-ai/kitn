/**
 * Structured tool use examples and description builder.
 *
 * Based on Anthropic research showing 72% -> 90% accuracy improvement
 * when tool descriptions include concrete examples.
 */

export interface ToolExample {
  /** Optional name for the example (e.g. "Minimal parameters") */
  name?: string;
  /** The example input object */
  input: Record<string, unknown>;
  /** Optional description of why this example matters */
  description?: string;
}

/**
 * Formats an array of ToolExamples into an XML-style `<examples>` block
 * suitable for appending to a tool description.
 */
export function formatExamplesBlock(examples: ToolExample[]): string {
  if (examples.length === 0) return "";

  const parts = examples.map((ex) => {
    const nameAttr = ex.name ? ` name="${ex.name}"` : "";
    const lines = [`<example${nameAttr}>`, JSON.stringify(ex.input)];
    if (ex.description) lines.push(ex.description);
    lines.push("</example>");
    return lines.join("\n");
  });

  return `<examples>\n${parts.join("\n")}\n</examples>`;
}

/**
 * Builds a complete tool description by appending formatted examples
 * to the base description string. Returns the base description unchanged
 * if no examples are provided.
 */
export function buildToolDescription(description: string, examples?: ToolExample[]): string {
  if (!examples || examples.length === 0) return description;
  return `${description}\n\n${formatExamplesBlock(examples)}`;
}
