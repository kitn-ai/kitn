import { createSignal, onCleanup } from "solid-js";

/**
 * Detect leading silence from MP3 encoder padding and return the offset
 * in seconds to skip it. MP3 encoders add ~1024-2304 samples of silence.
 */
function findStartGap(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > 0.0005) {
      return Math.max(0, i - 1) / buffer.sampleRate;
    }
  }
  return 0;
}

/**
 * Gapless audio player using Web Audio API.
 *
 * Uses AudioContext + AudioBufferSourceNode with sample-accurate scheduling
 * to eliminate gaps between sequential audio chunks. Each call to `schedule()`
 * queues a blob to play immediately after the previously scheduled audio ends.
 */
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [isPaused, setIsPaused] = createSignal(false);

  let ctx: AudioContext | null = null;
  let nextStartTime = 0;
  let activeSources: AudioBufferSourceNode[] = [];
  let pendingCount = 0;
  let doneResolve: (() => void) | null = null;
  let gainNode: GainNode | null = null;
  let pausedAt = 0;

  function getContext(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
      gainNode = ctx.createGain();
      gainNode.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function getGain(): GainNode {
    getContext();
    return gainNode!;
  }

  /** Schedule a blob for gapless playback after any previously scheduled audio. */
  async function schedule(blob: Blob): Promise<void> {
    const audioCtx = getContext();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const startGap = findStartGap(audioBuffer);

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(getGain());

    // Schedule right after previous chunk, or now + tiny offset for first chunk
    const startTime = Math.max(audioCtx.currentTime + 0.005, nextStartTime);
    source.start(startTime, startGap);

    const effectiveDuration = audioBuffer.duration - startGap;
    nextStartTime = startTime + effectiveDuration;

    activeSources.push(source);
    pendingCount++;
    setIsPlaying(true);

    source.onended = () => {
      pendingCount--;
      const idx = activeSources.indexOf(source);
      if (idx !== -1) activeSources.splice(idx, 1);
      if (pendingCount === 0) {
        setIsPlaying(false);
        setIsPaused(false);
        nextStartTime = 0;
        if (doneResolve) {
          doneResolve();
          doneResolve = null;
        }
      }
    };
  }

  /** Returns a promise that resolves when all scheduled audio finishes. */
  function waitForEnd(): Promise<void> {
    if (pendingCount === 0) return Promise.resolve();
    return new Promise((resolve) => {
      doneResolve = resolve;
    });
  }

  /**
   * Play a single blob (non-chunked). Provided for backward compatibility
   * with cached single-blob playback. Stops any current playback first.
   */
  function play(blob: Blob): Promise<void> {
    stop();
    return schedule(blob).then(() => waitForEnd());
  }

  function pause() {
    if (!ctx || !isPlaying() || isPaused()) return;
    pausedAt = ctx.currentTime;
    ctx.suspend();
    setIsPaused(true);
  }

  function resume() {
    if (!ctx || !isPlaying() || !isPaused()) return;
    // Shift scheduled times forward by the duration we were paused
    ctx.resume().then(() => {
      if (ctx && pausedAt > 0) {
        const pauseDuration = ctx.currentTime - pausedAt;
        nextStartTime += pauseDuration;
        pausedAt = 0;
      }
    });
    setIsPaused(false);
  }

  function stop() {
    for (const s of activeSources) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    activeSources = [];
    pendingCount = 0;
    nextStartTime = 0;
    pausedAt = 0;
    setIsPlaying(false);
    setIsPaused(false);
    // Resume context if it was suspended (paused)
    if (ctx?.state === "suspended") ctx.resume();
    if (doneResolve) {
      doneResolve();
      doneResolve = null;
    }
  }

  onCleanup(() => {
    stop();
    ctx?.close();
    ctx = null;
    gainNode = null;
  });

  return { isPlaying, isPaused, schedule, waitForEnd, play, pause, resume, stop };
}
