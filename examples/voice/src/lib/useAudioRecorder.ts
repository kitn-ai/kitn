import { createSignal } from "solid-js";

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];

  async function start(): Promise<void> {
    try {
      setError(null);
      chunks = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone access denied";
      setError(msg);
      throw err;
    }
  }

  function stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!mediaRecorder || mediaRecorder.state === "inactive") {
        reject(new Error("Not recording"));
        return;
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        chunks = [];

        // Stop all tracks to release the mic
        mediaRecorder?.stream.getTracks().forEach((t) => t.stop());
        mediaRecorder = null;

        setIsRecording(false);
        resolve(blob);
      };

      mediaRecorder.stop();
    });
  }

  return { isRecording, error, start, stop };
}
