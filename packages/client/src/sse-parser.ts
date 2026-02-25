export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

/**
 * Parse SSE events from a fetch Response with ReadableStream.
 * Needed because EventSource only supports GET — our endpoints are POST.
 */
export async function* parseSseStream(
  response: Response,
): AsyncGenerator<SseEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentData = "";
  let currentId = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Keep the last incomplete line in the buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        currentData = line.slice(5).trim();
      } else if (line.startsWith("id:")) {
        currentId = line.slice(3).trim();
      } else if (line === "") {
        // Empty line = end of event
        if (currentEvent && currentData) {
          yield { event: currentEvent, data: currentData, id: currentId };
        }
        currentEvent = "";
        currentData = "";
        currentId = "";
      }
    }
  }

  // Flush any remaining event
  if (currentEvent && currentData) {
    yield { event: currentEvent, data: currentData, id: currentId };
  }
}
