import { getEventBus } from "./delegation-context.js";
import { BUS_EVENTS, SSE_EVENTS } from "./events.js";
import type { StatusCode } from "./events.js";

export interface StatusPayload {
  code: StatusCode;
  message: string;
  agent?: string;
  metadata?: Record<string, unknown>;
}

interface StreamWriter {
  write(event: string, data: Record<string, unknown>): Promise<void>;
}

/** Emit a status event on the internal bus (for sub-agents, resilience, compaction). */
export function emitStatus(payload: StatusPayload): void {
  getEventBus()?.emit(BUS_EVENTS.STATUS, payload as unknown as Record<string, unknown>);
}

/** Write a status event directly to an SSE stream writer (for orchestrator top-level). */
export async function writeStatus(writer: StreamWriter, payload: StatusPayload): Promise<void> {
  await writer.write(SSE_EVENTS.STATUS, payload as unknown as Record<string, unknown>);
}
