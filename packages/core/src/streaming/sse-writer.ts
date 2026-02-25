export interface SSEMessage {
  event: string;
  data: string;
  id?: string;
}

export interface SSEWriter {
  writeSSE(message: SSEMessage): Promise<void>;
  close(): void;
}

/**
 * Creates a web-standard Response with SSE content.
 * The handler receives an SSEWriter to write events.
 * Returns a Response with Content-Type: text/event-stream.
 */
export function createSSEStream(
  handler: (writer: SSEWriter) => Promise<void>,
  signal?: AbortSignal,
): Response {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
    cancel() {
      // Stream was cancelled by the client
    },
  });

  const writer: SSEWriter = {
    async writeSSE({ event, data, id }) {
      let message = "";
      if (id) message += `id: ${id}\n`;
      message += `event: ${event}\n`;
      message += `data: ${data}\n\n`;
      try {
        controller.enqueue(encoder.encode(message));
      } catch {
        // Stream may be closed
      }
    },
    close() {
      try {
        controller.close();
      } catch {
        // Already closed
      }
    },
  };

  // Run the handler asynchronously
  handler(writer)
    .catch(() => {})
    .finally(() => writer.close());

  // Handle abort
  if (signal) {
    signal.addEventListener("abort", () => writer.close(), { once: true });
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
