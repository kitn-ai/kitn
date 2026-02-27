import { Elysia } from "elysia";
import type { PluginContext } from "@kitnai/core";
import { generateConversationId, runAgent } from "@kitnai/core";
import type { AIPluginConfig } from "../types.js";

const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/opus",
  wav: "audio/wav",
  aac: "audio/aac",
  flac: "audio/flac",
};

export function createVoiceRoutes(ctx: PluginContext) {
  function requireVoice(name?: string) {
    const provider = ctx.voice?.get(name);
    if (!provider) throw new Error("VOICE_UNAVAILABLE");
    return provider;
  }

  return new Elysia({ prefix: "/voice" })
    .get("/speakers", async ({ status }) => {
      let provider;
      try { provider = requireVoice(); } catch { return status(503, { error: "Voice provider not configured." }); }
      const speakers = await provider.getSpeakers();
      return { speakers: speakers.map((s) => ({ voiceId: s.voiceId, name: s.name })), provider: provider.name };
    })
    .get("/providers", async () => {
      if (!ctx.voice) return { providers: [] };
      const providers = ctx.voice.list();
      const defaultName = ctx.voice.getDefault();
      return { providers: providers.map((p) => ({ name: p.name, label: p.label, isDefault: p.name === defaultName })) };
    })
    .post("/transcribe", async ({ query, request, status }) => {
      const providerName = query.provider || undefined;
      let provider;
      try { provider = requireVoice(providerName); } catch {
        return status(503, { error: providerName ? `Voice provider "${providerName}" not available.` : "Voice provider not configured." });
      }
      const formData = await request.formData();
      const audioFile = formData.get("audio") as File | null;
      if (!audioFile) return status(400, { error: "No audio file provided." });

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
        return status(502, { error: message || "Transcription failed" });
      }

      let audioId: string | undefined;
      if (retainAudio) {
        const buf = Buffer.from(await audioFile.arrayBuffer());
        const entry = await ctx.storage.audio.saveAudio(buf, audioFile.type || "audio/webm", { transcription: result.text, source: "transcribe" });
        audioId = entry.id;
      }

      return { ...result, provider: provider.name, ...(audioId && { audioId }) };
    })
    .post("/speak", async ({ body, request, status }) => {
      let provider;
      try { provider = requireVoice(); } catch { return status(503, { error: "Voice provider not configured." }); }

      const b = body as any;
      const { text, speaker, format, speed, model, save } = b;
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
    })
    .post("/converse", async ({ query, request, status }) => {
      const sttProviderName = query.provider || undefined;
      let provider;
      try { provider = requireVoice(sttProviderName); } catch { return status(503, { error: "Voice provider not configured." }); }
      // Use default provider for TTS (speak) if STT provider differs
      const ttsProvider = sttProviderName ? requireVoice() : provider;

      const formData = await request.formData();
      const audioFile = formData.get("audio") as File | null;
      if (!audioFile) return status(400, { error: "No audio file provided." });

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
        return status(502, { error: message || "Transcription failed" });
      }
      if (!transcription.text.trim()) return status(400, { error: "Could not transcribe audio." });

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
    })
    .get("/audio", async () => {
      const entries = await ctx.storage.audio.listAudio();
      return { entries, count: entries.length };
    })
    .get("/audio/:id", async ({ params, status }) => {
      const result = await ctx.storage.audio.getAudio(params.id);
      if (!result) return status(404, { error: `Audio not found: ${params.id}` });
      return new Response(new Uint8Array(result.data), { headers: { "Content-Type": result.entry.mimeType, "Content-Length": String(result.entry.size) } });
    })
    .delete("/audio/:id", async ({ params }) => {
      const deleted = await ctx.storage.audio.deleteAudio(params.id);
      return { deleted };
    });
}
