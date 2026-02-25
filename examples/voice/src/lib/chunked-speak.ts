/**
 * Split text into sentence chunks for progressive TTS playback.
 * Exponential growth: 1, 2, 3, 5, 8 sentences per chunk.
 * First chunk is tiny for fast time-to-first-audio (~200-400ms).
 */
function splitIntoChunks(text: string): string[] {
  const sentences = text.match(/[^.!?]*[.!?]+[\s]*/g);
  if (!sentences || sentences.length <= 1) return [text];

  const chunks: string[] = [];
  const sizes = [1, 2, 3, 5, 8];
  let i = 0;
  let sizeIdx = 0;

  while (i < sentences.length) {
    const size = sizes[Math.min(sizeIdx, sizes.length - 1)];
    chunks.push(sentences.slice(i, i + size).join("").trim());
    i += size;
    sizeIdx++;
  }

  return chunks.filter((c) => c.length > 0);
}

export async function chunkedSpeak(
  text: string,
  synthesize: (chunk: string) => Promise<Blob>,
  schedule: (blob: Blob) => Promise<void>,
  waitForEnd: () => Promise<void>,
  isStopped: () => boolean,
): Promise<void> {
  const chunks = splitIntoChunks(text);

  // Fire all TTS requests immediately (pipelined)
  const promises = chunks.map((chunk) => synthesize(chunk));

  // Schedule each chunk for gapless playback as synthesis completes (in order)
  for (const promise of promises) {
    if (isStopped()) break;
    const blob = await promise;
    if (isStopped()) break;
    await schedule(blob);
  }

  // Wait for all scheduled audio to finish playing
  if (!isStopped()) {
    await waitForEnd();
  }
}
