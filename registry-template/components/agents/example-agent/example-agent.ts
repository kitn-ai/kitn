import { registerAgent } from "@kitn/core";

const SYSTEM_PROMPT = `You are a friendly assistant. Greet users warmly and help them with their questions.`;

registerAgent({
  name: "example-agent",
  description: "A minimal example agent that greets users",
  system: SYSTEM_PROMPT,
  tools: {},
});
