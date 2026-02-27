import { registerAgent } from "@kitn/core";
import { z } from "zod";

const SYSTEM_PROMPT = `You are a professional chef and recipe creator. When given a food topic or request, generate a complete, well-structured recipe.

Guidelines:
- Be specific with ingredient amounts and measurements
- Write clear, numbered step-by-step instructions
- Include practical cooking tips
- Set realistic prep/cook times and difficulty levels
- Adjust servings to reasonable defaults (usually 4)`;

export const recipeSchema = z.object({
  recipe: z.object({
    name: z.string().describe("The name of the recipe"),
    description: z.string().describe("A short appetizing description"),
    prepTime: z.string().describe("Preparation time (e.g. '15 minutes')"),
    cookTime: z.string().describe("Cooking time (e.g. '30 minutes')"),
    servings: z.number().describe("Number of servings"),
    difficulty: z.enum(["easy", "medium", "hard"]),
    ingredients: z.array(
      z.object({
        name: z.string(),
        amount: z.string(),
        notes: z.string().describe("Additional notes, or empty string if none"),
      })
    ),
    steps: z.array(
      z.object({
        step: z.number(),
        instruction: z.string(),
      })
    ),
    tips: z.array(z.string()).describe("Practical cooking tips"),
  }),
});

export type Recipe = z.infer<typeof recipeSchema>;

registerAgent({
  name: "recipe-agent",
  description: "Structured output recipe agent that generates complete recipes using generateObject with Zod schema",
  system: SYSTEM_PROMPT,
  tools: {},
});
