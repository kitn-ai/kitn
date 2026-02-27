import { registerAgent } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

const SYSTEM_PROMPT = `You are a skills management agent. You help users create, edit, and manage behavioral skills that modify how other agents approach tasks.

Skills are behavioral overlays -- they change HOW an agent responds, not WHAT it knows. Each skill is a markdown document with frontmatter metadata stored as a directory in the skills library.

When helping users create or edit skills, follow these guidelines:

**Descriptions** should specify triggering conditions using "Use when..." format:
- Good: "Use when the user asks to explain something simply or uses phrases like 'in simple terms'"
- Bad: "A skill that makes responses simpler" (this describes the skill, not when to use it)

**Content** should be behavioral instructions:
- Good: "Use everyday analogies", "Number your steps", "Lead with the direct answer"
- Bad: "You know about quantum physics" (that's knowledge, not behavior)

**Phase** controls when the skill is applied in the supervisor pipeline:
- "query" -- injected into the specialist agent (affects HOW it works, e.g. research behavior)
- "response" -- injected during synthesis (affects output STYLE, e.g. simplify, summarize)
- "both" -- applied at both stages
- Default is "response" if omitted

**Naming** must be kebab-case (lowercase, hyphens between words):
- Good: "step-by-step-reasoning", "eli5", "formal-writing"
- Bad: "StepByStep", "my skill", "ELI5"

**Workflow:**
1. Understand what behavioral change the user wants
2. List existing skills to check for overlap
3. Preview the skill content before creating
4. Create or update the skill

Use the available tools to manage skills. Always list existing skills before creating to avoid duplicates.`;

/**
 * In-memory skill store for demonstration purposes.
 * Replace with your own persistent storage backend.
 */
const skillStore = new Map<string, { name: string; description: string; content: string }>();

const listSkillsTool = tool({
  description: "List all available skills with their names, descriptions, and tags",
  inputSchema: z.object({}),
  execute: async () => {
    const skills = [...skillStore.values()];
    return { count: skills.length, skills };
  },
});

const getSkillTool = tool({
  description: "Get the full content of a specific skill by name",
  inputSchema: z.object({
    name: z.string().describe("The kebab-case name of the skill"),
  }),
  execute: async ({ name }) => {
    const skill = skillStore.get(name);
    if (!skill) return { found: false, name };
    return { found: true, ...skill };
  },
});

const createSkillTool = tool({
  description: "Create a new skill with the given name and markdown content (including frontmatter)",
  inputSchema: z.object({
    name: z.string().describe("Kebab-case skill name (e.g. 'formal-writing')"),
    content: z.string().describe("Full markdown content including ---frontmatter--- and body"),
  }),
  execute: async ({ name, content }) => {
    if (skillStore.has(name)) {
      return { created: false, error: `Skill '${name}' already exists` };
    }
    const skill = { name, description: `Skill: ${name}`, content };
    skillStore.set(name, skill);
    return { created: true, name: skill.name, description: skill.description };
  },
});

const updateSkillTool = tool({
  description: "Update an existing skill's content",
  inputSchema: z.object({
    name: z.string().describe("The kebab-case name of the skill to update"),
    content: z.string().describe("New full markdown content including ---frontmatter--- and body"),
  }),
  execute: async ({ name, content }) => {
    if (!skillStore.has(name)) {
      return { updated: false, error: `Skill '${name}' not found` };
    }
    const skill = { name, description: `Skill: ${name}`, content };
    skillStore.set(name, skill);
    return { updated: true, name: skill.name, description: skill.description };
  },
});

const deleteSkillTool = tool({
  description: "Delete a skill by name",
  inputSchema: z.object({
    name: z.string().describe("The kebab-case name of the skill to delete"),
  }),
  execute: async ({ name }) => {
    const deleted = skillStore.delete(name);
    return { deleted, name };
  },
});

registerAgent({
  name: "skills-agent",
  description: "Skills management agent that creates, edits, and manages behavioral skills for other agents",
  system: SYSTEM_PROMPT,
  tools: {
    listSkills: listSkillsTool,
    getSkill: getSkillTool,
    createSkill: createSkillTool,
    updateSkill: updateSkillTool,
    deleteSkill: deleteSkillTool,
  },
});
