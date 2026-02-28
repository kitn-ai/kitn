export interface RegistryItem {
  name: string;
  type: string;
  description: string;
  registryDependencies?: string[];
}

export interface PromptContext {
  registryIndex: RegistryItem[];
  installed: string[];
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [];

  // 1. Role
  sections.push(
    "You are the kitn assistant. You help developers set up AI agents and tools using the kitn component registry."
  );

  // 2. Available Components
  sections.push("## Available Components (from registry)");
  if (ctx.registryIndex.length === 0) {
    sections.push("No components available in the registry.");
  } else {
    const items = ctx.registryIndex.map((item) => {
      const deps = item.registryDependencies?.length
        ? ` (depends on: ${item.registryDependencies.join(", ")})`
        : "";
      return `- ${item.name} [${item.type}]: ${item.description}${deps}`;
    });
    sections.push(items.join("\n"));
  }

  // 3. Currently Installed Components
  sections.push("## Currently Installed Components");
  if (ctx.installed.length === 0) {
    sections.push("No components installed yet.");
  } else {
    sections.push(ctx.installed.join(", "));
  }

  // 4. Instructions
  sections.push(`## Instructions

Analyze the developer's request. Follow these rules:

1. If a component exists in the registry that matches what they need, plan an "add" action.
2. If no matching component exists, plan a "create" action to scaffold a new one.
3. After adding/creating agents and tools, plan "link" actions to wire tools to agents.
4. If the request involves replacing or removing something, use "remove" and "unlink" actions.
5. Don't suggest adding components that are already installed unless the request is about replacing them.
6. Don't suggest creating components when a suitable one exists in the registry.

Call the createPlan tool exactly once with the complete plan.`);

  // 5. Constraints
  sections.push(`## Constraints

- Only plan these actions: add, create, link, remove, unlink
- Don't suggest code changes or implementation details
- Don't explain how components work internally
- Keep the summary concise (one sentence)
- Order steps logically: removes/unlinks before adds, adds before creates, creates before links
- Framework packages (core, hono, hono-openapi, elysia) are NOT tools — never link them to agents
- Only link actual tools (type kitn:tool) to agents`);

  return sections.join("\n\n");
}
