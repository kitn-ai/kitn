export interface RulesConfig {
  version: string;
  tools: RulesTool[];
}

export interface RulesTool {
  id: string;
  name: string;
  filePath: string;
  format: "plain" | "mdc";
  description?: string;
  frontmatter?: Record<string, string>;
}

interface Aliases {
  base?: string;
  agents: string;
  tools: string;
  skills: string;
  storage: string;
  crons?: string;
}

export function renderTemplate(template: string, aliases: Aliases): string {
  const base = aliases.base ?? "src/ai";
  return template
    .replace(/\{base\}/g, base)
    .replace(/\{agents\}/g, aliases.agents)
    .replace(/\{tools\}/g, aliases.tools)
    .replace(/\{skills\}/g, aliases.skills)
    .replace(/\{storage\}/g, aliases.storage)
    .replace(/\{crons\}/g, aliases.crons ?? `${base}/crons`);
}

export function wrapContent(content: string, tool: RulesTool): string {
  if (tool.format === "mdc" && tool.frontmatter) {
    const lines = Object.entries(tool.frontmatter).map(
      ([key, value]) => `${key}: ${value}`,
    );
    return `---\n${lines.join("\n")}\n---\n\n${content}`;
  }
  return content;
}
