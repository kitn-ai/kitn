/** Registry of active streaming requests, keyed by conversationId.
 *  Used to abort in-flight AI SDK calls when the client cancels. */

const activeRequests = new Map<string, AbortController>();

/** Register a new request and return its AbortController. */
export function registerRequest(conversationId: string): AbortController {
  cancelRequest(conversationId);
  const controller = new AbortController();
  activeRequests.set(conversationId, controller);
  return controller;
}

/** Abort an active request. Returns true if one was found and aborted. */
export function cancelRequest(conversationId: string): boolean {
  const controller = activeRequests.get(conversationId);
  if (!controller) return false;
  controller.abort();
  activeRequests.delete(conversationId);
  return true;
}

/** Clean up after a request completes normally. */
export function unregisterRequest(conversationId: string): void {
  activeRequests.delete(conversationId);
}
