import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";

const port = Number(process.env.PORT) || 8080;

const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

async function handleMcp(req: Request): Promise<Response> {
  const sessionId = req.headers.get("mcp-session-id") ?? undefined;

  // Existing session
  if (sessionId && transports.has(sessionId)) {
    return transports.get(sessionId)!.handleRequest(req);
  }

  // New session — must be an initialize request
  if (req.method === "POST") {
    const body = await req.json();

    if (!isInitializeRequest(body)) {
      return new Response(JSON.stringify({ error: "Bad request — expected initialize" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };

    const server = createServer();
    await server.connect(transport);
    return transport.handleRequest(req, { parsedBody: body });
  }

  return new Response("Method not allowed", { status: 405 });
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/mcp") {
      return handleMcp(req);
    }

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`kitn MCP server (HTTP) listening on http://localhost:${server.port}/mcp`);
