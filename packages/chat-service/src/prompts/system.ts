export interface RegistryItem {
  name: string;
  type: string;
  description: string;
  registryDependencies?: string[];
}

export interface GlobalRegistryEntry {
  namespace: string;
  url: string;
  items: RegistryItem[];
}

export interface PromptContext {
  registryIndex: RegistryItem[];
  installed: string[];
  globalRegistryIndex?: GlobalRegistryEntry[];
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

  // 3. Components from Other Registries (not yet configured)
  if (ctx.globalRegistryIndex && ctx.globalRegistryIndex.length > 0) {
    sections.push("## Components from Other Registries (not configured by the user)");
    for (const entry of ctx.globalRegistryIndex) {
      if (entry.items.length === 0) continue;
      sections.push(`### ${entry.namespace} (url: ${entry.url})`);
      const items = entry.items.map((item) => {
        const deps = item.registryDependencies?.length
          ? ` (depends on: ${item.registryDependencies.join(", ")})`
          : "";
        return `- ${item.name} [${item.type}]: ${item.description}${deps}`;
      });
      sections.push(items.join("\n"));
    }
    sections.push(
      "To use components from these registries, first plan a \"registry-add\" action to configure the registry, then \"add\" the component."
    );
  }

  // 4. Currently Installed Components
  sections.push("## Currently Installed Components");
  if (ctx.installed.length === 0) {
    sections.push("No components installed yet.");
  } else {
    sections.push(ctx.installed.join(", "));
  }

  // 5. Instructions
  sections.push(`## Instructions

Analyze the developer's request. Follow these rules:

1. ONLY use "add" for components that are explicitly listed above. If a component is not in the "Available Components" or "Components from Other Registries" lists, it does NOT exist — do not invent component names.
2. If a matching component exists in the user's configured registries (listed under "Available Components"), plan an "add" action.
3. If a matching component exists in an unconfigured registry (listed under "Components from Other Registries"), plan a "registry-add" action first to configure that registry, then an "add" action for the component.
4. If nothing suitable exists in any list, plan a "create" action to scaffold a new component.
5. After adding/creating agents and tools, plan "link" actions to wire tools to agents.
6. If the request involves replacing or removing something, use "remove" and "unlink" actions.
7. Don't suggest adding components that are already installed unless the request is about replacing them.

Call the createPlan tool exactly once with the complete plan.`);

  // 6. Constraints
  sections.push(`## Constraints

- CRITICAL: Never use "add" for a component name that is not explicitly listed in the sections above. If it's not listed, use "create" instead.
- Only plan these actions: add, create, link, remove, unlink, registry-add
- For "registry-add", include the namespace and url fields
- Don't suggest code changes or implementation details
- Don't explain how components work internally
- Keep the summary concise (one sentence)
- Order steps logically: registry-adds first, then removes/unlinks, then adds, then creates, then links
- Framework packages (core, hono, hono-openapi, elysia) are NOT tools — never link them to agents
- Only link actual tools (type kitn:tool) to agents`);

  return sections.join("\n\n");
}
