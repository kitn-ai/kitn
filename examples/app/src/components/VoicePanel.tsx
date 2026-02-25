import { createSignal, For, Show, onCleanup, type Component } from "solid-js";
import { getJson, getBlob, postJsonRaw, postFormData, postFormDataRaw, deleteJson } from "../lib/api";
import { chunkedSpeak, AudioScheduler } from "@kitnai/client";
import JsonView from "./shared/JsonView.tsx";

interface VoiceProvider {
  name: string;
  label: string;
  isDefault: boolean;
}

interface Speaker {
  voiceId: string;
  name: string;
}

interface AudioEntry {
  id: string;
  mimeType: string;
  size: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

const VoicePanel: Component = () => {
  const [providers, setProviders] = createSignal<VoiceProvider[]>([]);
  const [speakers, setSpeakers] = createSignal<Speaker[]>([]);
  const [speakerProvider, setSpeakerProvider] = createSignal("");
  const [audioEntries, setAudioEntries] = createSignal<AudioEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [result, setResult] = createSignal<unknown>(null);
  const [activeAction, setActiveAction] = createSignal("");

  // TTS state
  const [ttsText, setTtsText] = createSignal("Hello! This is a test of the text-to-speech system.");
  const [ttsSpeaker, setTtsSpeaker] = createSignal("alloy");
  const [ttsFormat, setTtsFormat] = createSignal("mp3");
  const [ttsSave, setTtsSave] = createSignal(true);
  const [audioUrl, setAudioUrl] = createSignal<string | null>(null);
  const [chunkedEnabled, setChunkedEnabled] = createSignal(false);
  const [isPlaying, setIsPlaying] = createSignal(false);
  const scheduler = new AudioScheduler();
  let playbackStopped = false;

  // STT state
  const [transcription, setTranscription] = createSignal<string | null>(null);

  // Converse state
  const [converseTranscription, setConverseTranscription] = createSignal<string | null>(null);
  const [converseResponse, setConverseResponse] = createSignal<string | null>(null);
  const [converseAudioUrl, setConverseAudioUrl] = createSignal<string | null>(null);

  // Recording state
  const [recording, setRecording] = createSignal(false);
  const [recordingFor, setRecordingFor] = createSignal<"transcribe" | "converse" | null>(null);
  const [recordingDuration, setRecordingDuration] = createSignal(0);
  let mediaRecorder: MediaRecorder | null = null;
  let recordingChunks: Blob[] = [];
  let durationInterval: ReturnType<typeof setInterval> | null = null;

  // Availability
  const [voiceAvailable, setVoiceAvailable] = createSignal<boolean | null>(null);

  // Audio library playback
  const [libraryAudioUrl, setLibraryAudioUrl] = createSignal<string | null>(null);
  const [playingEntryId, setPlayingEntryId] = createSignal<string | null>(null);

  onCleanup(() => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    }
    if (durationInterval) clearInterval(durationInterval);
    scheduler.stop();
  });

  async function loadProviders() {
    try {
      const data = await getJson<{ providers: VoiceProvider[] }>("/api/voice/providers");
      setProviders(data.providers);
      setVoiceAvailable(data.providers.length > 0);
      if (data.providers.length > 0) {
        await loadSpeakers();
      }
    } catch (e: any) {
      if (e.status === 503 || e.status === 404) {
        setVoiceAvailable(false);
      } else {
        setError(e.message);
      }
    }
  }

  async function loadSpeakers() {
    try {
      const data = await getJson<{ speakers: Speaker[]; provider: string }>("/api/voice/speakers");
      setSpeakers(data.speakers);
      setSpeakerProvider(data.provider);
      if (data.speakers.length > 0 && !data.speakers.find((s) => s.voiceId === ttsSpeaker())) {
        setTtsSpeaker(data.speakers[0].voiceId);
      }
    } catch {
      // Voice not available
    }
  }

  async function loadAudioEntries() {
    setActiveAction("audio-list");
    setLoading(true);
    setError("");
    try {
      const data = await getJson<{ entries: AudioEntry[]; count: number }>("/api/voice/audio");
      setAudioEntries(data.entries);
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteAudioEntry(id: string) {
    setError("");
    try {
      if (playingEntryId() === id) {
        if (libraryAudioUrl()) URL.revokeObjectURL(libraryAudioUrl()!);
        setLibraryAudioUrl(null);
        setPlayingEntryId(null);
      }
      await deleteJson(`/api/voice/audio/${id}`);
      setAudioEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function playEntry(id: string) {
    setError("");
    if (libraryAudioUrl()) URL.revokeObjectURL(libraryAudioUrl()!);
    setLibraryAudioUrl(null);
    setPlayingEntryId(id);
    try {
      const blob = await getBlob(`/api/voice/audio/${id}`);
      setLibraryAudioUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      setError(e.message);
      setPlayingEntryId(null);
    }
  }

  async function speak() {
    setLoading(true);
    setError("");
    setActiveAction("speak");
    setResult(null);
    // Revoke previous audio URL
    if (audioUrl()) URL.revokeObjectURL(audioUrl()!);
    setAudioUrl(null);

    try {
      const res = await postJsonRaw("/api/voice/speak", {
        text: ttsText(),
        speaker: ttsSpeaker(),
        format: ttsFormat(),
        save: ttsSave(),
      });

      const audioId = res.headers.get("X-Audio-Id");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setResult({
        size: blob.size,
        type: blob.type,
        ...(audioId && { audioId }),
      });

      // Refresh audio list if saved
      if (ttsSave() && audioId) {
        loadAudioEntries();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function synthesizeChunk(chunk: string): Promise<Blob> {
    const res = await postJsonRaw("/api/voice/speak", {
      text: chunk,
      speaker: ttsSpeaker(),
      format: ttsFormat(),
      save: false,
    });
    return res.blob();
  }

  async function speakChunked() {
    setLoading(true);
    setError("");
    setActiveAction("speak-chunked");
    setResult(null);
    playbackStopped = false;

    try {
      setIsPlaying(true);
      await chunkedSpeak(
        ttsText(),
        synthesizeChunk,
        (blob) => scheduler.schedule(blob),
        () => scheduler.waitForEnd(),
        () => playbackStopped,
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsPlaying(false);
      setLoading(false);
      setResult({ mode: "chunked", status: "done" });
    }
  }

  function stopPlayback() {
    playbackStopped = true;
    scheduler.stop();
    setIsPlaying(false);
  }

  async function playResponseChunked(text: string) {
    setError("");
    playbackStopped = false;
    try {
      setIsPlaying(true);
      await chunkedSpeak(
        text,
        synthesizeChunk,
        (blob) => scheduler.schedule(blob),
        () => scheduler.waitForEnd(),
        () => playbackStopped,
      );
    } catch {
      // ignore — stop or playback error
    } finally {
      setIsPlaying(false);
    }
  }

  async function transcribe(file: File) {
    setLoading(true);
    setError("");
    setActiveAction("transcribe");
    setResult(null);
    setTranscription(null);

    const formData = new FormData();
    formData.append("audio", file);

    try {
      const data = await postFormData<{ text: string; language?: string; duration?: number; provider?: string }>(
        "/api/voice/transcribe?provider=groq",
        formData,
      );
      setTranscription(data.text);
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function converse(file: File) {
    setLoading(true);
    setError("");
    setActiveAction("converse");
    setResult(null);
    setConverseTranscription(null);
    setConverseResponse(null);
    if (converseAudioUrl()) URL.revokeObjectURL(converseAudioUrl()!);
    setConverseAudioUrl(null);

    const formData = new FormData();
    formData.append("audio", file);
    formData.append("format", "mp3");

    try {
      const res = await postFormDataRaw("/api/voice/converse?provider=groq", formData);
      const transcribedText = res.headers.get("X-Transcription");
      const responseText = res.headers.get("X-Response-Text");
      const convId = res.headers.get("X-Conversation-Id");

      if (transcribedText) setConverseTranscription(decodeURIComponent(transcribedText));
      if (responseText) setConverseResponse(decodeURIComponent(responseText));

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setConverseAudioUrl(url);

      setResult({
        transcription: transcribedText ? decodeURIComponent(transcribedText) : null,
        responseText: responseText ? decodeURIComponent(responseText) : null,
        conversationId: convId,
        audioSize: blob.size,
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function startRecording(target: "transcribe" | "converse") {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingChunks = [];
      setRecordingDuration(0);
      setRecordingFor(target);

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      mediaRecorder = new MediaRecorder(stream, { mimeType });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordingChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (durationInterval) { clearInterval(durationInterval); durationInterval = null; }
        setRecording(false);

        const blob = new Blob(recordingChunks, { type: mimeType });
        const file = new File([blob], "recording.webm", { type: mimeType });

        if (target === "transcribe") {
          transcribe(file);
        } else {
          converse(file);
        }
        setRecordingFor(null);
      };

      mediaRecorder.start(250);
      setRecording(true);

      durationInterval = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch (e: any) {
      setError(`Microphone access denied: ${e.message}`);
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function handleFileInput(callback: (file: File) => void) {
    return (e: Event) => {
      const input = e.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      if (file) callback(file);
      input.value = "";
    };
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Load on mount
  loadProviders();
  loadAudioEntries();

  return (
    <div class="flex-1 overflow-auto panel-scroll">
      <div class="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h2 class="font-display text-xl font-semibold text-heading">Voice</h2>
          <p class="text-sm text-secondary mt-1">Text-to-speech, speech-to-text, and voice conversation</p>
        </div>

        {/* Voice unavailable notice */}
        <Show when={voiceAvailable() === false}>
          <div class="bg-warning/8 border border-warning/20 rounded-lg p-4">
            <p class="text-sm font-medium text-warning">Voice Not Available</p>
            <p class="text-xs text-warning/70 mt-1">
              No voice provider configured. Set OPENAI_API_KEY or GROQ_API_KEY in the test server .env to enable voice features.
            </p>
          </div>
        </Show>

        <Show when={voiceAvailable()}>
          {/* Providers */}
          <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
            <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">
              {providers().length} Provider(s)
            </div>
            <div class="space-y-2">
              <For each={providers()}>
                {(p) => (
                  <div class="bg-surface rounded-lg border border-border px-4 py-3 text-sm flex items-center gap-3">
                    <span class="font-medium text-accent">{p.name}</span>
                    <span class="text-secondary">{p.label}</span>
                    <Show when={p.isDefault}>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-accent/12 text-accent font-mono">default</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <Show when={speakers().length > 0}>
              <div class="text-[10px] font-semibold uppercase tracking-widest text-muted mt-4">
                Speakers ({speakerProvider()})
              </div>
              <div class="flex flex-wrap gap-2">
                <For each={speakers()}>
                  {(s) => (
                    <span class="text-xs px-2 py-1 rounded-md bg-raised border border-border font-mono text-secondary">
                      {s.name} <span class="text-muted">({s.voiceId})</span>
                    </span>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Text-to-Speech */}
          <div class="bg-surface rounded-lg border border-border p-4 space-y-4">
            <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">Text-to-Speech</div>
            <textarea
              class="w-full bg-input rounded-md border border-border px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent/50 font-mono resize-none"
              rows={3}
              value={ttsText()}
              onInput={(e) => setTtsText(e.currentTarget.value)}
              placeholder="Enter text to speak..."
            />
            <div class="flex flex-wrap items-center gap-3">
              <select
                class="bg-input rounded-md border border-border px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent/50 font-mono"
                value={ttsSpeaker()}
                onChange={(e) => setTtsSpeaker(e.currentTarget.value)}
              >
                <Show when={speakers().length > 0} fallback={
                  <For each={["alloy", "echo", "fable", "nova", "onyx", "shimmer"]}>
                    {(v) => <option value={v}>{v}</option>}
                  </For>
                }>
                  <For each={speakers()}>
                    {(s) => <option value={s.voiceId}>{s.name}</option>}
                  </For>
                </Show>
              </select>
              <select
                class="bg-input rounded-md border border-border px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent/50 font-mono"
                value={ttsFormat()}
                onChange={(e) => setTtsFormat(e.currentTarget.value)}
              >
                <For each={["mp3", "opus", "wav", "aac", "flac"]}>
                  {(f) => <option value={f}>{f}</option>}
                </For>
              </select>
              <label class="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={ttsSave()}
                  onChange={(e) => setTtsSave(e.currentTarget.checked)}
                  class="accent-accent"
                />
                Save to server
              </label>
              <label class="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={chunkedEnabled()}
                  onChange={(e) => setChunkedEnabled(e.currentTarget.checked)}
                  class="accent-accent"
                />
                Chunked playback
              </label>
              <Show when={isPlaying()} fallback={
                <button
                  class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-root border border-accent hover:bg-accent-bright transition-colors disabled:opacity-40"
                  onClick={chunkedEnabled() ? speakChunked : speak}
                  disabled={loading() || !ttsText().trim()}
                >
                  {loading() && (activeAction() === "speak" || activeAction() === "speak-chunked") ? "Generating..." : "Speak"}
                </button>
              }>
                <button
                  class="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white border border-danger hover:bg-danger/80 transition-colors"
                  onClick={stopPlayback}
                >
                  Stop
                </button>
              </Show>
            </div>
            <Show when={audioUrl()}>
              <div class="bg-raised rounded-md p-3">
                <audio controls src={audioUrl()!} class="w-full" />
              </div>
            </Show>
          </div>

          {/* Speech-to-Text */}
          <div class="bg-surface rounded-lg border border-border p-4 space-y-4">
            <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">Speech-to-Text</div>
            <p class="text-xs text-secondary">Record from your microphone or upload an audio file to transcribe.</p>
            <div class="flex items-center gap-3">
              <Show when={recording() && recordingFor() === "transcribe"} fallback={
                <button
                  class="rounded-md bg-danger/15 px-4 py-2 text-sm font-medium text-danger border border-danger/30 hover:bg-danger/25 transition-colors disabled:opacity-40"
                  onClick={() => startRecording("transcribe")}
                  disabled={loading() || (recording() && recordingFor() !== "transcribe")}
                >
                  Record
                </button>
              }>
                <button
                  class="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white border border-danger hover:bg-danger/80 transition-colors animate-pulse"
                  onClick={stopRecording}
                >
                  Stop ({formatDuration(recordingDuration())})
                </button>
              </Show>
              <label class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-root border border-accent hover:bg-accent-bright transition-colors cursor-pointer">
                {loading() && activeAction() === "transcribe" ? "Transcribing..." : "Upload File"}
                <input
                  type="file"
                  accept="audio/*"
                  class="hidden"
                  onChange={handleFileInput(transcribe)}
                  disabled={loading()}
                />
              </label>
              <span class="text-xs text-muted">Record or upload mp3, wav, webm, m4a</span>
            </div>
            <Show when={transcription()}>
              <div class="bg-raised rounded-md p-3">
                <div class="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">Transcription</div>
                <p class="text-sm text-primary whitespace-pre-wrap">{transcription()}</p>
              </div>
            </Show>
          </div>

          {/* Voice Conversation */}
          <div class="bg-surface rounded-lg border border-border p-4 space-y-4">
            <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">Voice Conversation</div>
            <p class="text-xs text-secondary">Record or upload audio for a full conversation: transcribe → agent → speak response.</p>
            <div class="flex items-center gap-3">
              <Show when={recording() && recordingFor() === "converse"} fallback={
                <button
                  class="rounded-md bg-danger/15 px-4 py-2 text-sm font-medium text-danger border border-danger/30 hover:bg-danger/25 transition-colors disabled:opacity-40"
                  onClick={() => startRecording("converse")}
                  disabled={loading() || (recording() && recordingFor() !== "converse")}
                >
                  Record
                </button>
              }>
                <button
                  class="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white border border-danger hover:bg-danger/80 transition-colors animate-pulse"
                  onClick={stopRecording}
                >
                  Stop ({formatDuration(recordingDuration())})
                </button>
              </Show>
              <label class="rounded-md bg-purple/15 px-4 py-2 text-sm font-medium text-purple border border-purple/30 hover:bg-purple/25 transition-colors cursor-pointer">
                {loading() && activeAction() === "converse" ? "Processing..." : "Upload File"}
                <input
                  type="file"
                  accept="audio/*"
                  class="hidden"
                  onChange={handleFileInput(converse)}
                  disabled={loading()}
                />
              </label>
              <span class="text-xs text-muted">Full round-trip: audio in → text → agent → audio out</span>
            </div>
            <Show when={converseTranscription()}>
              <div class="bg-raised rounded-md p-3 space-y-3">
                <div>
                  <div class="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">You said</div>
                  <p class="text-sm text-primary">{converseTranscription()}</p>
                </div>
                <Show when={converseResponse()}>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">Agent response</div>
                    <p class="text-sm text-primary whitespace-pre-wrap">{converseResponse()}</p>
                  </div>
                </Show>
                <Show when={converseAudioUrl()}>
                  <audio controls src={converseAudioUrl()!} class="w-full" />
                </Show>
                <Show when={converseResponse()}>
                  <Show when={isPlaying()} fallback={
                    <button
                      class="rounded-md bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent border border-accent/30 hover:bg-accent/25 transition-colors"
                      onClick={() => playResponseChunked(converseResponse()!)}
                    >
                      Play Response (chunked)
                    </button>
                  }>
                    <button
                      class="rounded-md bg-danger/15 px-3 py-1.5 text-xs font-medium text-danger border border-danger/30 hover:bg-danger/25 transition-colors"
                      onClick={stopPlayback}
                    >
                      Stop Playback
                    </button>
                  </Show>
                </Show>
              </div>
            </Show>
          </div>

          {/* Audio Library */}
          <div class="bg-surface rounded-lg border border-border p-4 space-y-4">
            <div class="flex items-center justify-between">
              <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">Audio Library</div>
              <button
                class="rounded-md bg-raised px-3 py-1.5 text-xs font-medium text-primary border border-border hover:border-accent/30 transition-colors"
                onClick={loadAudioEntries}
              >
                Refresh
              </button>
            </div>
            <Show when={audioEntries().length > 0}>
              <div class="space-y-2">
                <For each={audioEntries()}>
                  {(entry) => (
                    <div class="space-y-2">
                      <div class="bg-raised rounded-md px-4 py-3 text-sm flex items-center gap-3">
                        <span class="font-mono text-accent text-xs truncate max-w-[200px]">{entry.id}</span>
                        <span class="text-muted text-xs">{entry.mimeType}</span>
                        <span class="text-muted text-xs">{formatBytes(entry.size)}</span>
                        <span class="text-muted text-xs ml-auto">{new Date(entry.createdAt).toLocaleTimeString()}</span>
                        <button
                          class="rounded px-2 py-1 text-xs font-medium text-info bg-info/10 border border-info/20 hover:bg-info/20 transition-colors"
                          onClick={() => playEntry(entry.id)}
                        >
                          {playingEntryId() === entry.id && !libraryAudioUrl() ? "Loading..." : "Play"}
                        </button>
                        <button
                          class="rounded px-2 py-1 text-xs font-medium text-danger bg-danger/10 border border-danger/20 hover:bg-danger/20 transition-colors"
                          onClick={() => deleteAudioEntry(entry.id)}
                        >
                          Delete
                        </button>
                      </div>
                      <Show when={playingEntryId() === entry.id && libraryAudioUrl()}>
                        <div class="bg-raised rounded-md p-3 ml-4">
                          <audio controls autoplay src={libraryAudioUrl()!} class="w-full" />
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={audioEntries().length === 0}>
              <p class="text-xs text-muted">No stored audio. Use "Save to server" when speaking to store audio entries.</p>
            </Show>
          </div>
        </Show>

        {error() && <p class="text-sm text-danger">{error()}</p>}
        <Show when={result()}>
          <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
            <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">Result: {activeAction()}</div>
            <JsonView data={result()} />
          </div>
        </Show>
      </div>
    </div>
  );
};

export default VoicePanel;
