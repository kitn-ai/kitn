import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

const WORDS = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(" ");

function randomWords(count: number): string {
  const result: string[] = [];
  for (let i = 0; i < count; i++) result.push(WORDS[Math.floor(Math.random() * WORDS.length)]);
  return result.join(" ");
}

function sentence(): string {
  const len = 8 + Math.floor(Math.random() * 12);
  const s = randomWords(len);
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

function paragraph(): string {
  const count = 3 + Math.floor(Math.random() * 4);
  return Array.from({ length: count }, () => sentence()).join(" ");
}

export const loremIpsumTool = tool({
  description: "Generate Lorem Ipsum placeholder text in paragraphs, sentences, or words",
  inputSchema: z.object({
    unit: z.enum(["paragraphs", "sentences", "words"]).default("paragraphs").describe("Unit of text to generate"),
    count: z.number().min(1).max(50).default(3).describe("Number of units to generate"),
    startWithLorem: z.boolean().default(true).describe("Start with the classic 'Lorem ipsum dolor sit amet...'"),
  }),
  execute: async ({ unit, count, startWithLorem }) => {
    let text: string;
    switch (unit) {
      case "paragraphs":
        text = Array.from({ length: count }, () => paragraph()).join("\n\n");
        break;
      case "sentences":
        text = Array.from({ length: count }, () => sentence()).join(" ");
        break;
      case "words":
        text = randomWords(count);
        break;
    }
    if (startWithLorem) text = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " + text;
    return { text, unit, count };
  },
});

registerTool({
  name: "lorem-ipsum",
  description: "Generate Lorem Ipsum placeholder text in paragraphs, sentences, or words",
  inputSchema: z.object({ unit: z.enum(["paragraphs", "sentences", "words"]).default("paragraphs"), count: z.number().min(1).max(50).default(3), startWithLorem: z.boolean().default(true) }),
  tool: loremIpsumTool,
});
