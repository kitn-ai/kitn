/**
 * In-memory SSE event buffer for reconnectable job streaming.
 *
 * Buffers events for each job ID so that clients who disconnect and reconnect
 * can replay missed events. Live listeners are notified immediately on push.
 */

export interface BufferedEvent {
  id: string;
  event: string;
  data: string;
}

type EventListener = (event: BufferedEvent) => void;

export interface EventBuffer {
  /** Store an event and notify any live listeners for this job. */
  push(jobId: string, event: BufferedEvent): void;
  /** Get all buffered events for a job (for replay on reconnect). */
  replay(jobId: string): BufferedEvent[];
  /** Remove buffer and listeners for a job. */
  cleanup(jobId: string): void;
  /** Subscribe to live events for a job. Returns an unsubscribe function. */
  addListener(jobId: string, listener: EventListener): () => void;
  /** Check if any active listeners exist for a job. */
  hasListeners(jobId: string): boolean;
}

/** Create an in-memory event buffer for SSE job streaming. */
export function createEventBuffer(): EventBuffer {
  const buffers = new Map<string, BufferedEvent[]>();
  const listeners = new Map<string, Set<EventListener>>();

  return {
    push(jobId: string, event: BufferedEvent): void {
      // Buffer the event
      if (!buffers.has(jobId)) {
        buffers.set(jobId, []);
      }
      buffers.get(jobId)!.push(event);

      // Notify live listeners
      const jobListeners = listeners.get(jobId);
      if (jobListeners) {
        for (const listener of jobListeners) {
          listener(event);
        }
      }
    },

    replay(jobId: string): BufferedEvent[] {
      return buffers.get(jobId) ?? [];
    },

    cleanup(jobId: string): void {
      buffers.delete(jobId);
      listeners.delete(jobId);
    },

    addListener(jobId: string, listener: EventListener): () => void {
      if (!listeners.has(jobId)) {
        listeners.set(jobId, new Set());
      }
      const jobListeners = listeners.get(jobId)!;
      jobListeners.add(listener);

      return () => {
        jobListeners.delete(listener);
        // Clean up the set if empty
        if (jobListeners.size === 0) {
          listeners.delete(jobId);
        }
      };
    },

    hasListeners(jobId: string): boolean {
      const jobListeners = listeners.get(jobId);
      return jobListeners !== undefined && jobListeners.size > 0;
    },
  };
}
