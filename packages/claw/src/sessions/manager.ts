/**
 * Session manager with serial queue per session.
 *
 * Ensures one message at a time per session, preventing race conditions
 * from concurrent messages (a critical lesson from OpenClaw).
 */
export class SessionManager {
  private queues = new Map<string, Promise<void>>();

  /**
   * Enqueue a task for a session. Tasks are executed serially —
   * the next task won't start until the previous one completes.
   */
  async enqueue(sessionId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(sessionId) ?? Promise.resolve();
    const next = prev.then(task, task); // always chain, even on error
    this.queues.set(sessionId, next);
    return next;
  }

  /**
   * Check if a session has pending tasks.
   */
  hasPending(sessionId: string): boolean {
    return this.queues.has(sessionId);
  }

  /**
   * Clear a session's queue (e.g. on session end).
   */
  clear(sessionId: string): void {
    this.queues.delete(sessionId);
  }
}
