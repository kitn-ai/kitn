import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const translateTool = tool({
  description: "Translate text between languages using DeepL",
  inputSchema: z.object({
    text: z.string().describe("Text to translate"),
    targetLang: z.string().describe("Target language code (e.g. EN, DE, FR, ES, JA, ZH)"),
    sourceLang: z.string().optional().describe("Source language code (auto-detected if omitted)"),
    formality: z.enum(["default", "more", "less", "prefer_more", "prefer_less"]).default("default"),
  }),
  execute: async ({ text, targetLang, sourceLang, formality }) => {
    const key = process.env.DEEPL_API_KEY;
    if (!key) throw new Error("DEEPL_API_KEY environment variable is required");
    const isFree = key.endsWith(":fx");
    const base = isFree ? "https://api-free.deepl.com" : "https://api.deepl.com";
    const res = await fetch(`${base}/v2/translate`, {
      method: "POST",
      headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: [text], target_lang: targetLang.toUpperCase(), ...(sourceLang ? { source_lang: sourceLang.toUpperCase() } : {}), formality }),
    });
    if (!res.ok) throw new Error(`DeepL API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const t = data.translations[0];
    return { translatedText: t.text, detectedSourceLang: t.detected_source_language, targetLang };
  },
});

registerTool({ name: "translate", description: "Translate text between languages using DeepL", inputSchema: z.object({ text: z.string(), targetLang: z.string(), sourceLang: z.string().optional(), formality: z.enum(["default", "more", "less", "prefer_more", "prefer_less"]).default("default") }), tool: translateTool });
