import { createInterface } from "readline";
import type { OutboundMessage } from "../channels/types.js";

/**
 * Connect to a remote KitnClaw gateway via WebSocket.
 * Provides a simple readline-based interactive session.
 */
export async function connectRemote(url: string, authToken?: string): Promise<void> {
  // Normalize URL: ensure it uses ws:// or wss:// and ends with /ws
  let wsUrl = url;
  if (wsUrl.startsWith("http://")) {
    wsUrl = wsUrl.replace("http://", "ws://");
  } else if (wsUrl.startsWith("https://")) {
    wsUrl = wsUrl.replace("https://", "wss://");
  } else if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
    wsUrl = `ws://${wsUrl}`;
  }
  if (!wsUrl.endsWith("/ws")) {
    wsUrl = wsUrl.replace(/\/$/, "") + "/ws";
  }

  // Append auth token as query parameter
  if (authToken) {
    const separator = wsUrl.includes("?") ? "&" : "?";
    wsUrl += `${separator}token=${encodeURIComponent(authToken)}`;
  }

  const sessionId = `remote-${Math.random().toString(36).slice(2, 10)}`;

  console.log(`Connecting to ${wsUrl.replace(/\?token=.*$/, "")}...`);

  const ws = new WebSocket(wsUrl);

  const connected = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10000);
    ws.onopen = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      resolve(false);
    };
  });

  if (!connected) {
    console.error("Failed to connect. Check the URL and try again.");
    process.exit(1);
  }

  console.log(`Connected. Session: ${sessionId}`);
  console.log('Type your message and press Enter. Type "exit" or Ctrl+C to disconnect.\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let pendingResolve: ((response: OutboundMessage | null) => void) | null = null;

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string);
      if (pendingResolve) {
        pendingResolve(data);
        pendingResolve = null;
      }
    } catch {
      console.error("Received invalid response from server.");
    }
  };

  ws.onclose = () => {
    console.log("\nDisconnected from server.");
    rl.close();
    process.exit(0);
  };

  ws.onerror = () => {
    console.error("WebSocket error.");
    rl.close();
    process.exit(1);
  };

  const prompt = () => {
    rl.question("> ", async (input) => {
      const text = input.trim();

      if (!text) {
        prompt();
        return;
      }

      if (text.toLowerCase() === "exit") {
        console.log("Disconnecting...");
        ws.close();
        rl.close();
        return;
      }

      // Send message and wait for response
      ws.send(JSON.stringify({ sessionId, text }));

      const response = await new Promise<OutboundMessage | null>((resolve) => {
        pendingResolve = resolve;
        // Timeout after 60 seconds
        setTimeout(() => {
          if (pendingResolve === resolve) {
            pendingResolve = null;
            resolve(null);
          }
        }, 60000);
      });

      if (response) {
        // Print tool calls (dimmed)
        if (response.toolCalls && response.toolCalls.length > 0) {
          for (const tc of response.toolCalls) {
            console.log(`\x1b[2m[tool: ${tc.name}]\x1b[0m`);
          }
        }

        // Print assistant text
        if (response.text) {
          console.log(`\n${response.text}\n`);
        }
      } else {
        console.log("\n(No response received — timed out)\n");
      }

      prompt();
    });
  };

  prompt();

  // Handle Ctrl+C
  rl.on("close", () => {
    ws.close();
  });
}
