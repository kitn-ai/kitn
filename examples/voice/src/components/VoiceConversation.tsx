import { createSignal, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { useAudioRecorder } from "../lib/useAudioRecorder";
import { useAudioPlayer } from "../lib/useAudioPlayer";
import { createLocalStore } from "../lib/createLocalStore";
import {
  transcribe,
  speak,
  getSpeakers,
  getProviders,
  getAudioUrl,
  streamSupervisor,
  type Speaker,
  type SttProvider,
  type SseEvent,
} from "../lib/api";
import { chunkedSpeak } from "../lib/chunked-speak";
import type { Status, Exchange } from "./types";
import SettingsPanel from "./SettingsPanel";
import ExchangeCard from "./ExchangeCard";
import ReviewBar from "./ReviewBar";
import ErrorBanner from "./ErrorBanner";
import MicButton from "./MicButton";

export default function VoiceConversation() {
  const recorder = useAudioRecorder();
  const player = useAudioPlayer();

  const [status, setStatus] = createSignal<Status>("idle");
  const [store, setStore] = createStore<{ exchanges: Exchange[] }>({ exchanges: [] });
  const [speakers, setSpeakers] = createSignal<Speaker[]>([]);
  const [conversationId, setConversationId] = createSignal<string | undefined>();
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  const [showSettings, setShowSettings] = createSignal(false);
  const [reviewText, setReviewText] = createSignal("");
  const [sttProviders, setSttProviders] = createSignal<SttProvider[]>([]);
  const [playingExchangeId, setPlayingExchangeId] = createSignal<number | null>(null);

  const [settings, setSettings] = createLocalStore("vc-settings", {
    speaker: "alloy",
    sttProvider: "openai",
  });

  const audioCache = new Map<number, Blob>();

  let scrollRef: HTMLDivElement | undefined;
  let nextId = 1;

  // ---------- Init ----------

  onMount(async () => {
    try {
      const [s, p] = await Promise.all([getSpeakers(), getProviders()]);
      setSpeakers(s);
      if (p.length > 0) {
        setSttProviders(p);
        if (!settings.sttProvider || !p.find((x) => x.name === settings.sttProvider)) {
          const def = p.find((x) => x.isDefault);
          if (def) setSettings("sttProvider", def.name);
        }
      }
      if (s.length > 0 && !s.find((x) => x.voiceId === settings.speaker)) {
        setSettings("speaker", s[0].voiceId);
      }
    } catch {
      // Voice might not be configured
    }
  });

  // ---------- Spacebar push-to-talk ----------

  function isInputFocused(): boolean {
    const tag = document.activeElement?.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.code !== "Space" || e.repeat || isInputFocused()) return;
    if (status() !== "idle") return;
    e.preventDefault();
    handleMicDown();
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.code !== "Space" || isInputFocused()) return;
    if (status() !== "recording") return;
    e.preventDefault();
    handleMicUp();
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
  });

  // Auto-scroll
  createEffect(() => {
    if (store.exchanges.length && scrollRef) {
      scrollRef.scrollTop = scrollRef.scrollHeight;
    }
  });

  function findIdx(exchangeId: number): number {
    return store.exchanges.findIndex((ex) => ex.id === exchangeId);
  }

  // ---------- Recording ----------

  async function handleMicDown() {
    setErrorMsg(null);
    try {
      await recorder.start();
      setStatus("recording");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Microphone access denied");
    }
  }

  async function handleMicUp() {
    if (!recorder.isRecording()) return;
    try {
      const audioBlob = await recorder.stop();
      setStatus("transcribing");
      const result = await transcribe(audioBlob, { provider: settings.sttProvider });
      setReviewText(result.text);
      setStatus("reviewing");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Transcription failed");
      setStatus("idle");
    }
  }

  // ---------- Send ----------

  function handleCancelReview() {
    setReviewText("");
    setStatus("idle");
  }

  async function handleSend() {
    const text = reviewText().trim();
    if (!text) return;

    setReviewText("");
    setStatus("streaming");

    const exchangeId = nextId++;
    setStore("exchanges", store.exchanges.length, {
      id: exchangeId,
      userText: text,
      agentText: "",
      activityLog: [],
      isComplete: false,
      timestamp: new Date(),
    });

    try {
      for await (const event of streamSupervisor(text, {
        conversationId: conversationId(),
      })) {
        processEvent(exchangeId, event);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Stream failed");
    }

    const idx = findIdx(exchangeId);
    if (idx !== -1) setStore("exchanges", idx, "isComplete", true);
    setStatus("idle");
  }

  // ---------- SSE processing ----------

  function processEvent(exchangeId: number, event: SseEvent) {
    const idx = findIdx(exchangeId);
    if (idx === -1) return;

    switch (event.event) {
      case "text-delta": {
        const text = tryParseJson(event.data)?.text ?? event.data;
        setStore("exchanges", idx, "agentText", (prev) => prev + text);
        if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
        break;
      }
      case "agent:start": {
        const d = tryParseJson(event.data);
        pushActivity(idx, { type: "agent-start", label: d?.agent ? `Agent started: ${d.agent}` : "Agent started" });
        break;
      }
      case "agent:end": {
        const d = tryParseJson(event.data);
        pushActivity(idx, { type: "agent-end", label: d?.agent ? `Agent finished: ${d.agent}` : "Agent finished" });
        break;
      }
      case "delegate:start": {
        const d = tryParseJson(event.data);
        pushActivity(idx, {
          type: "delegate-start",
          label: d?.from && d?.to ? `Delegating: ${d.from} \u2192 ${d.to}` : "Delegating to sub-agent",
          detail: d?.reason,
        });
        break;
      }
      case "delegate:end": {
        const d = tryParseJson(event.data);
        pushActivity(idx, { type: "delegate-end", label: d?.agent ? `Delegate complete: ${d.agent}` : "Delegate complete" });
        break;
      }
      case "tool:call": {
        const d = tryParseJson(event.data);
        pushActivity(idx, {
          type: "tool-call",
          label: d?.tool ? `Tool call: ${d.tool}` : "Tool call",
          detail: d?.args ? JSON.stringify(d.args) : undefined,
        });
        break;
      }
      case "tool:result": {
        const d = tryParseJson(event.data);
        pushActivity(idx, { type: "tool-result", label: d?.tool ? `Tool result: ${d.tool}` : "Tool result" });
        break;
      }
      case "agent:think": {
        const d = tryParseJson(event.data);
        pushActivity(idx, { type: "agent-think", label: d?.text ? `Thinking: ${d.text.slice(0, 80)}` : "Thinking..." });
        break;
      }
      case "agent:plan": {
        const d = tryParseJson(event.data);
        const count = d?.tasks?.length ?? d?.steps?.length;
        pushActivity(idx, { type: "agent-plan", label: count ? `Plan: ${count} tasks` : "Planning...", detail: d?.summary });
        break;
      }
      case "done": {
        const d = tryParseJson(event.data);
        if (d?.conversationId) setConversationId(d.conversationId);
        if (d?.usage) setStore("exchanges", idx, "usage", d.usage);
        break;
      }
    }
  }

  function pushActivity(idx: number, activity: { type: string; label: string; detail?: string }) {
    const len = store.exchanges[idx].activityLog.length;
    setStore("exchanges", idx, "activityLog", len, activity as any);
  }

  function tryParseJson(data: string): any {
    try { return JSON.parse(data); } catch { return null; }
  }

  // ---------- Playback ----------

  async function handlePlayResponse(exchangeId: number, text: string) {
    try {
      setPlayingExchangeId(exchangeId);
      setStatus("speaking");

      const cached = audioCache.get(exchangeId);
      if (cached) {
        await player.play(cached);
      } else {
        let firstAudioId: string | undefined;
        await chunkedSpeak(
          text,
          async (chunk) => {
            const result = await speak(chunk, { speaker: settings.speaker });
            if (!firstAudioId && result.audioId) firstAudioId = result.audioId;
            return result.blob;
          },
          (blob) => player.schedule(blob),
          () => player.waitForEnd(),
          () => status() !== "speaking",
        );
        if (firstAudioId) {
          const idx = findIdx(exchangeId);
          if (idx !== -1) setStore("exchanges", idx, "audioId", firstAudioId);
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Playback failed");
    } finally {
      setPlayingExchangeId(null);
      setStatus("idle");
    }
  }

  function handleDownload(exchangeId: number) {
    const cached = audioCache.get(exchangeId);
    const ex = store.exchanges.find((e) => e.id === exchangeId);
    const url = cached
      ? URL.createObjectURL(cached)
      : ex?.audioId
        ? getAudioUrl(ex.audioId)
        : null;
    if (!url) return;

    const a = document.createElement("a");
    a.href = url;
    a.download = `response-${exchangeId}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (cached) URL.revokeObjectURL(url);
  }

  async function handleCopy(_exchangeId: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setErrorMsg("Failed to copy to clipboard");
    }
  }

  // ---------- Helpers ----------

  function statusLabel(): string {
    switch (status()) {
      case "recording":    return "Recording...";
      case "transcribing": return "Transcribing...";
      case "reviewing":    return "Review transcription";
      case "streaming":    return "Agent is working...";
      case "speaking":     return "Playing audio...";
      default:             return "Hold to speak";
    }
  }

  // ---------- Render ----------

  return (
    <div class="vc-root">
      <header class="vc-header">
        <div class="vc-header-left">
          <div class="vc-logo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
          <h1 class="vc-title">Voice Agent</h1>
        </div>
        <button
          class="vc-settings-btn"
          onClick={() => setShowSettings(!showSettings())}
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      <Show when={showSettings()}>
        <SettingsPanel
          speaker={settings.speaker}
          onSpeakerChange={(v) => setSettings("speaker", v)}
          speakers={speakers()}
          sttProvider={settings.sttProvider}
          onSttProviderChange={(v) => setSettings("sttProvider", v)}
          sttProviders={sttProviders()}
        />
      </Show>

      <div class="vc-history" ref={scrollRef}>
        <Show when={store.exchanges.length === 0}>
          <div class="vc-empty">
            <div class="vc-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <p class="vc-empty-text">Hold the microphone to start a conversation</p>
            <p class="vc-empty-sub">
              Hold to record, release to review, then send to the supervisor agent.
              You can also hold <kbd class="vc-kbd">Space</kbd> to record.
            </p>
          </div>
        </Show>

        <For each={store.exchanges}>
          {(ex) => (
            <ExchangeCard
              exchange={ex}
              isPlaying={player.isPlaying()}
              isPaused={player.isPaused()}
              isPlayingThis={playingExchangeId() === ex.id}
              hasAudioCache={audioCache.has(ex.id)}
              onPlay={handlePlayResponse}
              onPause={() => player.pause()}
              onResume={() => player.resume()}
              onStop={() => player.stop()}
              onDownload={handleDownload}
              onCopy={handleCopy}
            />
          )}
        </For>
      </div>

      <Show when={status() === "reviewing"}>
        <ReviewBar
          text={reviewText()}
          onTextChange={setReviewText}
          onSend={handleSend}
          onCancel={handleCancelReview}
        />
      </Show>

      <ErrorBanner message={errorMsg()} onDismiss={() => setErrorMsg(null)} />

      <div class="vc-controls">
        <div class="vc-status">{statusLabel()}</div>
        <Show when={!player.isPlaying()}>
          <MicButton
            status={status()}
            onMicDown={handleMicDown}
            onMicUp={handleMicUp}
            isRecording={recorder.isRecording}
          />
        </Show>
      </div>
    </div>
  );
}
