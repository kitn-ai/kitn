import { z } from "zod";

const classificationSchema = z.object({
  allowed: z.boolean().describe("Whether the query is a personal finance question"),
  category: z.enum([
    "budgeting",
    "investing",
    "debt",
    "savings",
    "taxes",
    "retirement",
    "off-topic",
  ]).describe("The finance category, or 'off-topic' if not finance-related"),
  reason: z.string().describe("Brief explanation of the classification decision"),
});

const CLASSIFICATION_PROMPT = `You are a content classifier for a personal finance advisor.
Your job is to determine whether the user's message is a personal finance question.

Allowed topics: budgeting, investing, debt management, savings, taxes, retirement planning.
Block anything unrelated to personal finance (cooking, sports, coding, general chat, etc.).

Classify the message and provide a brief reason for your decision.`;

const FINANCE_ADVISOR_PROMPT = `You are a knowledgeable personal finance advisor.
Provide clear, actionable advice based on the user's question.

Guidelines:
- Give practical, specific advice
- Mention relevant rules of thumb (e.g., 50/30/20 budget, emergency fund = 3-6 months expenses)
- Note when professional advice should be sought for complex situations
- Keep responses concise but thorough`;

export const GUARDRAILS_AGENT_CONFIG = {
  classificationSchema,
  classificationPrompt: CLASSIFICATION_PROMPT,
  advicePrompt: FINANCE_ADVISOR_PROMPT,
  system: CLASSIFICATION_PROMPT,
  tools: {} as Record<string, never>,
};
