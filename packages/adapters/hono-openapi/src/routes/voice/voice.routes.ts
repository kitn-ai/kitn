import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { PluginContext } from "@kitnai/core";
import { speakRequestSchema, transcribeResponseSchema, speakersResponseSchema, generateConversationId, runAgent } from "@kitnai/core";
import type { AIPluginConfig } from "../../types.js";

const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/opus",
  wav: "audio/wav",
  aac: "audio/aac",
  flac: "audio/flac",
};

export function createVoiceRoutes(ctx: PluginContext) {
  const router = new OpenAPIHono();

  function requireVoice(name?: string) {
    const provider = ctx.voice?.get(name);
    if (!provider) throw new Error("VOICE_UNAVAILABLE");
    return provider;
  }

  // GET /speakers
  router.openapi(
    createRoute({
      method: "get", path: "/speakers", tags: ["Voice"], summary: "List available voice speakers",
      responses: {
        200: { description: "List of speakers", content: { "application/json": { schema: speakersResponseSchema } } },
        503: { description: "Voice provider not configured", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    // hono/zod-openapi handler type mismatch
    (async (c: any) => {
      let provider;
      try { provider = requireVoice(); } catch { return c.json({ error: "Voice provider not configured." }, 503); }
      const speakers = await provider.getSpeakers();
      return c.json({ speakers: speakers.map((s) => ({ voiceId: s.voiceId, name: s.name })), provider: provider.name });
    }) as any,
  );

  // GET /providers
  router.openapi(
    createRoute({
      method: "get", path: "/providers", tags: ["Voice"], summary: "List available transcription providers",
      responses: { 200: { description: "List of providers", content: { "application/json": { schema: z.object({ providers: z.array(z.object({ name: z.string(), label: z.string(), isDefault: z.boolean() })) }) } } } },
    }),
    async (c) => {
      if (!ctx.voice) return c.json({ providers: [] });
      const providers = ctx.voice.list();
      const defaultName = ctx.voice.getDefault();
      return c.json({ providers: providers.map((p) => ({ name: p.name, label: p.label, isDefault: p.name === defaultName })) });
    },
  );

  // POST /transcribe
  router.openapi(
    createRoute({
      method: "post", path: "/transcribe", tags: ["Voice"], summary: "Transcribe audio to text",
      request: {
        query: z.object({ provider: z.string().optional() }),
        body: { content: { "multipart/form-data": { schema: z.object({ audio: z.any().openapi({ type: "string", format: "binary" }), language: z.string().optional(), prompt: z.string().optional() }) } } },
      },
      responses: {
        200: { description: "Transcription result", content: { "application/json": { schema: transcribeResponseSchema } } },
        400: { description: "No audio file", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
        503: { description: "Voice provider not configured", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    // hono/zod-openapi handler type mismatch
    (async (c: any) => {
      const providerName = c.req.query("provider") || undefined;
      let provider;
      try { provider = requireVoice(providerName); } catch {
        return c.json({ error: providerName ? `Voice provider "${providerName}" not available.` : "Voice provider not configured." }, 503);
      }
      const formData = await c.req.formData();
      const audioFile = formData.get("audio") as File | null;
      if (!audioFile) return c.json({ error: "No audio file provided." }, 400);

      const language = formData.get("language") as string | null;
      const prompt = formData.get("prompt") as string | null;
      const retainAudio = formData.get("retainAudio") === "true" || (ctx.config as AIPluginConfig).voice?.retainAudio;

      let result;
      try {
        result = await provider.transcribe(audioFile, {
          language: language ?? undefined,
          prompt: prompt ?? undefined,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[voice/transcribe] Transcription failed:", message);
        return c.json({ error: message || "Transcription failed" }, 502);
      }

      let audioId: string | undefined;
      if (retainAudio) {
        const buf = Buffer.from(await audioFile.arrayBuffer());
        const entry = await ctx.storage.audio.saveAudio(buf, audioFile.type || "audio/webm", { transcription: result.text, source: "transcribe" });
        audioId = entry.id;
      }

      return c.json({ ...result, provider: provider.name, ...(audioId && { audioId }) });
    }) as any,
  );

  // POST /speak
  router.openapi(
    createRoute({
      method: "post", path: "/speak", tags: ["Voice"], summary: "Convert text to speech",
      request: { body: { content: { "application/json": { schema: speakRequestSchema } } } },
      responses: {
        200: { description: "Audio stream" },
        503: { description: "Voice provider not configured", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    // hono/zod-openapi handler type mismatch
    (async (c: any) => {
      let provider;
      try { provider = requireVoice(); } catch { return c.json({ error: "Voice provider not configured." }, 503); }

      const body = await c.req.json();
      const { text, speaker, format, speed, model, save } = body;
      const audioFormat = format ?? "mp3";
      const audioStream = await provider.speak(text, { speaker, format: audioFormat, speed, model });

      const mimeType = AUDIO_MIME_TYPES[audioFormat] ?? "audio/mpeg";

      if (save) {
        const chunks: Uint8Array[] = [];
        const reader = audioStream instanceof ReadableStream ? audioStream.getReader() : null;
        if (reader) {
          while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
        } else {
          for await (const chunk of audioStream as AsyncIterable<Uint8Array>) { chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)); }
        }
        const buffer = Buffer.concat(chunks);
        const entry = await ctx.storage.audio.saveAudio(buffer, mimeType, { text, speaker, source: "speak" });
        return new Response(new Uint8Array(buffer), { headers: { "Content-Type": mimeType, "Content-Length": String(buffer.length), "X-Audio-Id": entry.id } });
      }

      return new Response(audioStream, { headers: { "Content-Type": mimeType, "Transfer-Encoding": "chunked" } });
    }) as any,
  );

  // POST /converse
  router.openapi(
    createRoute({
      method: "post", path: "/converse", tags: ["Voice"],
      summary: "Voice conversation (audio in, audio out)",
      description: "Full cycle: transcribe audio -> run agent -> speak response.",
      request: {
        query: z.object({ provider: z.string().optional() }),
        body: { content: { "multipart/form-data": { schema: z.object({
          audio: z.any().openapi({ type: "string", format: "binary" }),
          speaker: z.string().optional(), format: z.string().optional(), speed: z.string().optional(),
          model: z.string().optional(), conversationId: z.string().optional(), agent: z.string().optional(),
        }) } } },
      },
      responses: {
        200: { description: "Audio response stream with metadata headers" },
        400: { description: "No audio file", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
        503: { description: "Voice provider not configured", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    // hono/zod-openapi handler type mismatch
    (async (c: any) => {
      const sttProviderName = c.req.query("provider") || undefined;
      let provider;
      try { provider = requireVoice(sttProviderName); } catch { return c.json({ error: "Voice provider not configured." }, 503); }
      // Use default provider for TTS (speak) if STT provider differs
      const ttsProvider = sttProviderName ? requireVoice() : provider;

      const formData = await c.req.formData();
      const audioFile = formData.get("audio") as File | null;
      if (!audioFile) return c.json({ error: "No audio file provided." }, 400);

      const speaker = (formData.get("speaker") as string) ?? undefined;
      const format = (formData.get("format") as string) ?? "mp3";
      const speed = formData.get("speed") ? parseFloat(formData.get("speed") as string) : undefined;
      const model = (formData.get("model") as string) ?? undefined;
      const conversationId = (formData.get("conversationId") as string) ?? undefined;

      // Step 1: Transcribe
      let transcription;
      try {
        transcription = await provider.transcribe(audioFile);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[voice/converse] Transcription failed:", message);
        return c.json({ error: message || "Transcription failed" }, 502);
      }
      if (!transcription.text.trim()) return c.json({ error: "Could not transcribe audio." }, 400);

      // Step 2: Run agent — prefer a regular agent with tools (not the orchestrator)
      const requestedAgent = formData.get("agent") as string | null;
      const orchestrators = ctx.agents.getOrchestratorNames();
      const regularAgents = ctx.agents.list().filter((a) => !orchestrators.has(a.name) && a.tools && Object.keys(a.tools).length > 0);
      const agentName = requestedAgent ?? regularAgents[0]?.name ?? ctx.agents.list()[0]?.name ?? "assistant";
      const agent = ctx.agents.get(agentName);
      const systemPrompt = agent ? await ctx.agents.getResolvedPrompt(agentName) ?? "" : "You are a helpful assistant.";
      const agentResult = await runAgent(ctx, { system: systemPrompt, tools: agent?.tools ?? {} }, transcription.text, model);
      const responseText = agentResult.response;
      const convId = generateConversationId(conversationId);

      // Step 3: Speak response
      const audioFormat = (format as "mp3" | "opus" | "wav" | "aac" | "flac") ?? "mp3";
      const audioStream = await ttsProvider.speak(responseText, { speaker, format: audioFormat, speed });

      return new Response(audioStream, {
        headers: {
          "Content-Type": AUDIO_MIME_TYPES[audioFormat] ?? "audio/mpeg",
          "Transfer-Encoding": "chunked",
          "X-Transcription": encodeURIComponent(transcription.text),
          "X-Response-Text": encodeURIComponent(responseText),
          "X-Conversation-Id": convId,
        },
      });
    }) as any,
  );

  // GET /audio
  router.openapi(
    createRoute({
      method: "get", path: "/audio", tags: ["Voice"], summary: "List stored audio entries",
      responses: { 200: { description: "List of audio entries", content: { "application/json": { schema: z.object({ entries: z.array(z.object({ id: z.string(), mimeType: z.string(), size: z.number(), createdAt: z.string() })), count: z.number() }) } } } },
    }),
    async (c) => {
      const entries = await ctx.storage.audio.listAudio();
      return c.json({ entries, count: entries.length });
    },
  );

  // GET /audio/:id
  router.openapi(
    createRoute({
      method: "get", path: "/audio/{id}", tags: ["Voice"], summary: "Get stored audio file",
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: { description: "Audio file" }, 404: { description: "Audio not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } } },
    }),
    // hono/zod-openapi handler type mismatch
    (async (c: any) => {
      const id = c.req.param("id");
      const result = await ctx.storage.audio.getAudio(id);
      if (!result) return c.json({ error: `Audio not found: ${id}` }, 404);
      return new Response(new Uint8Array(result.data), { headers: { "Content-Type": result.entry.mimeType, "Content-Length": String(result.entry.size) } });
    }) as any,
  );

  // DELETE /audio/:id
  router.openapi(
    createRoute({
      method: "delete", path: "/audio/{id}", tags: ["Voice"], summary: "Delete stored audio file",
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: { description: "Deletion result", content: { "application/json": { schema: z.object({ deleted: z.boolean() }) } } } },
    }),
    async (c) => {
      const id = c.req.param("id");
      const deleted = await ctx.storage.audio.deleteAudio(id);
      return c.json({ deleted });
    },
  );

  return router;
}
