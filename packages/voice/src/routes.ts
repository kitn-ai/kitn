import type { PluginRoute, PluginHandlerContext } from "@kitnai/core";
import { runAgent, generateConversationId } from "@kitnai/core";
import type { VoiceManager } from "./voice-manager.js";
import type { AudioStore } from "./audio-store.js";

const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/opus",
  wav: "audio/wav",
  aac: "audio/aac",
  flac: "audio/flac",
};

export interface VoiceRoutesConfig {
  voiceManager: VoiceManager;
  audioStore?: AudioStore;
  retainAudio?: boolean;
}

export function createVoiceRoutes(config: VoiceRoutesConfig): PluginRoute[] {
  const { voiceManager, audioStore, retainAudio: defaultRetainAudio } = config;

  function requireVoice(name?: string) {
    const provider = voiceManager.get(name);
    if (!provider) throw new Error("VOICE_UNAVAILABLE");
    return provider;
  }

  return [
    // GET /speakers — list speakers from default provider
    {
      method: "GET",
      path: "/speakers",
      schema: { summary: "List available speakers from the default voice provider", tags: ["Voice"] },
      async handler(_ctx: PluginHandlerContext) {
        let provider;
        try {
          provider = requireVoice();
        } catch {
          return Response.json({ error: "Voice provider not configured." }, { status: 503 });
        }
        const speakers = await provider.getSpeakers();
        return Response.json({
          speakers: speakers.map((s) => ({ voiceId: s.voiceId, name: s.name })),
          provider: provider.name,
        });
      },
    },

    // GET /providers — list all registered providers
    {
      method: "GET",
      path: "/providers",
      schema: { summary: "List all registered voice providers", tags: ["Voice"] },
      async handler(_ctx: PluginHandlerContext) {
        const providers = voiceManager.list();
        const defaultName = voiceManager.getDefault();
        return Response.json({
          providers: providers.map((p) => ({
            name: p.name,
            label: p.label,
            isDefault: p.name === defaultName,
          })),
        });
      },
    },

    // POST /transcribe — transcribe audio to text
    {
      method: "POST",
      path: "/transcribe",
      schema: { summary: "Transcribe audio to text", tags: ["Voice"] },
      async handler(ctx: PluginHandlerContext) {
        const url = new URL(ctx.request.url);
        const providerName = url.searchParams.get("provider") || undefined;
        let provider;
        try {
          provider = requireVoice(providerName);
        } catch {
          return Response.json(
            { error: providerName ? `Voice provider "${providerName}" not available.` : "Voice provider not configured." },
            { status: 503 },
          );
        }

        const formData = await ctx.request.formData();
        const audioFile = formData.get("audio") as File | null;
        if (!audioFile) return Response.json({ error: "No audio file provided." }, { status: 400 });

        const language = formData.get("language") as string | null;
        const prompt = formData.get("prompt") as string | null;
        const retainAudio = formData.get("retainAudio") === "true" || defaultRetainAudio;

        let result;
        try {
          result = await provider.transcribe(audioFile, {
            language: language ?? undefined,
            prompt: prompt ?? undefined,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[voice/transcribe] Transcription failed:", message);
          return Response.json({ error: message || "Transcription failed" }, { status: 502 });
        }

        let audioId: string | undefined;
        if (retainAudio && audioStore) {
          const buf = Buffer.from(await audioFile.arrayBuffer());
          const entry = await audioStore.saveAudio(buf, audioFile.type || "audio/webm", {
            transcription: result.text,
            source: "transcribe",
          });
          audioId = entry.id;
        }

        return Response.json({ ...result, provider: provider.name, ...(audioId && { audioId }) });
      },
    },

    // POST /speak — text to speech, return streaming audio
    {
      method: "POST",
      path: "/speak",
      schema: { summary: "Convert text to speech audio", tags: ["Voice"] },
      async handler(ctx: PluginHandlerContext) {
        let provider;
        try {
          provider = requireVoice();
        } catch {
          return Response.json({ error: "Voice provider not configured." }, { status: 503 });
        }

        const body = await ctx.request.json();
        const { text, speaker, format, speed, model, save } = body;
        const audioFormat = format ?? "mp3";
        const audioStream = await provider.speak(text, { speaker, format: audioFormat, speed, model });
        const mimeType = AUDIO_MIME_TYPES[audioFormat] ?? "audio/mpeg";

        if (save && audioStore) {
          const chunks: Uint8Array[] = [];
          const reader = audioStream instanceof ReadableStream ? audioStream.getReader() : null;
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
          } else {
            for await (const chunk of audioStream as AsyncIterable<Uint8Array>) {
              chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
            }
          }
          const buffer = Buffer.concat(chunks);
          const entry = await audioStore.saveAudio(buffer, mimeType, { text, speaker, source: "speak" });
          return new Response(new Uint8Array(buffer), {
            headers: {
              "Content-Type": mimeType,
              "Content-Length": String(buffer.length),
              "X-Audio-Id": entry.id,
            },
          });
        }

        return new Response(audioStream, {
          headers: { "Content-Type": mimeType, "Transfer-Encoding": "chunked" },
        });
      },
    },

    // POST /converse — transcribe, run agent, speak response
    {
      method: "POST",
      path: "/converse",
      schema: { summary: "Full voice conversation: transcribe, run agent, speak response", tags: ["Voice"] },
      async handler(ctx: PluginHandlerContext) {
        const url = new URL(ctx.request.url);
        const sttProviderName = url.searchParams.get("provider") || undefined;
        let provider;
        try {
          provider = requireVoice(sttProviderName);
        } catch {
          return Response.json({ error: "Voice provider not configured." }, { status: 503 });
        }
        // Use default provider for TTS (speak) if STT provider differs
        const ttsProvider = sttProviderName ? requireVoice() : provider;

        const formData = await ctx.request.formData();
        const audioFile = formData.get("audio") as File | null;
        if (!audioFile) return Response.json({ error: "No audio file provided." }, { status: 400 });

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
          return Response.json({ error: message || "Transcription failed" }, { status: 502 });
        }
        if (!transcription.text.trim()) {
          return Response.json({ error: "Could not transcribe audio." }, { status: 400 });
        }

        // Step 2: Run agent — prefer a regular agent with tools (not the orchestrator)
        const requestedAgent = formData.get("agent") as string | null;
        const orchestrators = ctx.pluginContext.agents.getOrchestratorNames();
        const regularAgents = ctx.pluginContext.agents
          .list()
          .filter((a) => !orchestrators.has(a.name) && a.tools && Object.keys(a.tools).length > 0);
        const agentName = requestedAgent ?? regularAgents[0]?.name ?? ctx.pluginContext.agents.list()[0]?.name ?? "assistant";
        const agent = ctx.pluginContext.agents.get(agentName);
        const systemPrompt = agent ? (await ctx.pluginContext.agents.getResolvedPrompt(agentName)) ?? "" : "You are a helpful assistant.";
        const agentResult = await runAgent(ctx.pluginContext, { system: systemPrompt, tools: agent?.tools ?? {} }, transcription.text, model);
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
      },
    },

    // GET /audio — list saved audio entries
    {
      method: "GET",
      path: "/audio",
      schema: { summary: "List saved audio entries", tags: ["Voice"] },
      async handler(_ctx: PluginHandlerContext) {
        if (!audioStore) return Response.json({ entries: [], count: 0 });
        const entries = await audioStore.listAudio();
        return Response.json({ entries, count: entries.length });
      },
    },

    // GET /audio/:id — retrieve saved audio binary
    {
      method: "GET",
      path: "/audio/:id",
      schema: { summary: "Retrieve saved audio by ID", tags: ["Voice"] },
      async handler(ctx: PluginHandlerContext) {
        if (!audioStore) return Response.json({ error: "Audio storage not configured." }, { status: 503 });
        const id = ctx.params.id;
        const result = await audioStore.getAudio(id);
        if (!result) return Response.json({ error: `Audio not found: ${id}` }, { status: 404 });
        return new Response(new Uint8Array(result.data), {
          headers: {
            "Content-Type": result.entry.mimeType,
            "Content-Length": String(result.entry.size),
          },
        });
      },
    },

    // DELETE /audio/:id — delete saved audio
    {
      method: "DELETE",
      path: "/audio/:id",
      schema: { summary: "Delete saved audio by ID", tags: ["Voice"] },
      async handler(ctx: PluginHandlerContext) {
        if (!audioStore) return Response.json({ error: "Audio storage not configured." }, { status: 503 });
        const id = ctx.params.id;
        const deleted = await audioStore.deleteAudio(id);
        return Response.json({ deleted });
      },
    },
  ];
}
