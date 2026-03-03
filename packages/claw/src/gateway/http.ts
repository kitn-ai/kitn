import type { OutboundMessage } from "../channels/types.js";

export interface HttpServerOptions {
  port: number;
  hostname?: string;
  authToken?: string;
  getStatus?: () => Record<string, unknown>;
  onMessage?: (sessionId: string, text: string) => Promise<OutboundMessage>;
}

export interface HttpServer {
  start(): { port: number };
  stop(): void;
}

/**
 * Create a lightweight HTTP server using Bun.serve.
 * Provides health, status, message, and SSE stream endpoints.
 */
export function createHttpServer(opts: HttpServerOptions): HttpServer {
  const { authToken, getStatus, onMessage } = opts;

  // SSE connections keyed by sessionId
  const sseControllers = new Map<string, Set<ReadableStreamDefaultController>>();

  function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function checkAuth(req: Request): Response | null {
    if (!authToken) return null;
    const header = req.headers.get("Authorization");
    if (header !== `Bearer ${authToken}`) {
      return json({ error: "Unauthorized" }, 401);
    }
    return null;
  }

  async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;

    // GET /health — no auth
    if (pathname === "/health" && req.method === "GET") {
      return json({ status: "ok" });
    }

    // Auth gate for /api/* routes
    if (pathname.startsWith("/api/")) {
      const authErr = checkAuth(req);
      if (authErr) return authErr;
    }

    // GET /api/status
    if (pathname === "/api/status" && req.method === "GET") {
      const status = getStatus ? getStatus() : {};
      return json(status);
    }

    // POST /api/message
    if (pathname === "/api/message" && req.method === "POST") {
      try {
        const body = await req.json() as Record<string, unknown>;
        if (!body.sessionId || !body.text) {
          return json({ error: "Missing sessionId or text" }, 400);
        }
        if (!onMessage) {
          return json({ error: "No message handler configured" }, 503);
        }
        const response = await onMessage(body.sessionId as string, body.text as string);

        // Push to any SSE listeners for this session
        const controllers = sseControllers.get(body.sessionId as string);
        if (controllers) {
          const event = `data: ${JSON.stringify(response)}\n\n`;
          const encoder = new TextEncoder();
          for (const ctrl of controllers) {
            try {
              ctrl.enqueue(encoder.encode(event));
            } catch {
              // Controller may have been closed
            }
          }
        }

        return json(response);
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }
    }

    // GET /api/stream?sessionId=
    if (pathname === "/api/stream" && req.method === "GET") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        return json({ error: "Missing sessionId query parameter" }, 400);
      }

      let ctrl: ReadableStreamDefaultController;
      const stream = new ReadableStream({
        start(controller) {
          ctrl = controller;
          // Send initial SSE comment so the response resolves immediately
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(":connected\n\n"));
          if (!sseControllers.has(sessionId)) {
            sseControllers.set(sessionId, new Set());
          }
          sseControllers.get(sessionId)!.add(controller);
        },
        cancel() {
          const controllers = sseControllers.get(sessionId);
          if (controllers) {
            controllers.delete(ctrl);
            if (controllers.size === 0) {
              sseControllers.delete(sessionId);
            }
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // 404 for everything else
    return json({ error: "Not found" }, 404);
  }

  let bunServer: ReturnType<typeof Bun.serve> | null = null;

  return {
    start() {
      bunServer = Bun.serve({
        port: opts.port,
        hostname: opts.hostname ?? "127.0.0.1",
        fetch: handleRequest,
      });
      return { port: bunServer.port! };
    },
    stop() {
      if (bunServer) {
        bunServer.stop(true);
        bunServer = null;
      }
      // Clean up SSE controllers
      sseControllers.clear();
    },
  };
}
