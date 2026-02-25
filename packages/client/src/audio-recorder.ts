/**
 * Framework-agnostic microphone recorder.
 * Uses callback pattern instead of framework-specific signals.
 */
export class AudioRecorder {
  private _recording = false;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType: string;
  private onStateChange?: (recording: boolean) => void;

  get recording(): boolean {
    return this._recording;
  }

  constructor(opts?: {
    mimeType?: string;
    onStateChange?: (recording: boolean) => void;
  }) {
    this.mimeType = opts?.mimeType ?? "audio/webm";
    this.onStateChange = opts?.onStateChange;
  }

  private setRecording(value: boolean): void {
    this._recording = value;
    this.onStateChange?.(value);
  }

  /** Request mic access and start recording */
  async start(): Promise<void> {
    this.chunks = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType: this.mimeType,
    });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };

    this.mediaRecorder.start();
    this.setRecording(true);
  }

  /** Stop recording and return the audio blob */
  async stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        reject(new Error("Not recording"));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType });
        this.chunks = [];

        // Stop all tracks to release the mic
        this.mediaRecorder?.stream.getTracks().forEach((t) => t.stop());
        this.mediaRecorder = null;

        this.setRecording(false);
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  /** Release mic without returning data */
  cancel(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stream.getTracks().forEach((t) => t.stop());
      this.mediaRecorder.stop();
      this.mediaRecorder = null;
    }
    this.chunks = [];
    this.setRecording(false);
  }
}
