/**
 * Framework-agnostic Web Audio API scheduler for gapless playback
 * of audio chunks (e.g. from chunked TTS synthesis).
 */
export class AudioScheduler {
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private activeSources: AudioBufferSourceNode[] = [];
  private nextStartTime = 0;
  private pendingCount = 0;
  private doneResolve: (() => void) | null = null;

  private getContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === "suspended") this.audioCtx.resume();
    return this.audioCtx;
  }

  private findStartGap(buffer: AudioBuffer): number {
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > 0.0005) {
        return Math.max(0, i - 1) / buffer.sampleRate;
      }
    }
    return 0;
  }

  /** Decode blob and schedule for gapless playback */
  async schedule(blob: Blob): Promise<void> {
    const ctx = this.getContext();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const startGap = this.findStartGap(audioBuffer);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode!);

    const startTime = Math.max(ctx.currentTime + 0.005, this.nextStartTime);
    source.start(startTime, startGap);
    this.nextStartTime = startTime + (audioBuffer.duration - startGap);

    this.activeSources.push(source);
    this.pendingCount++;

    source.onended = () => {
      this.pendingCount--;
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) this.activeSources.splice(idx, 1);
      if (this.pendingCount === 0 && this.doneResolve) {
        this.doneResolve();
        this.doneResolve = null;
      }
    };
  }

  /** Returns a promise that resolves when all scheduled audio finishes */
  waitForEnd(): Promise<void> {
    if (this.pendingCount === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.doneResolve = resolve;
    });
  }

  /** Stop all playing audio and reset */
  stop(): void {
    for (const s of this.activeSources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.activeSources = [];
    this.pendingCount = 0;
    this.nextStartTime = 0;
    if (this.doneResolve) {
      this.doneResolve();
      this.doneResolve = null;
    }
  }

  /** Set volume (0-1) */
  setVolume(v: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = v;
    }
  }
}
