/** Metadata for a stored audio file */
export interface AudioEntry {
  id: string;
  mimeType: string;
  size: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Stores and retrieves audio files for the voice subsystem.
 *
 * Audio entries are identified by auto-generated IDs. Return `null` from
 * `getAudio()` when not found (do not throw).
 * `cleanupOlderThan()` removes entries older than the given age for garbage collection.
 */
export interface AudioStore {
  /** Save an audio buffer and return its entry metadata. */
  saveAudio(buffer: Buffer | Uint8Array, mimeType: string, metadata?: Record<string, unknown>, scopeId?: string): Promise<AudioEntry>;
  /** Retrieve an audio file by ID. Returns `null` if not found. */
  getAudio(id: string, scopeId?: string): Promise<{ entry: AudioEntry; data: Buffer } | null>;
  /** Delete an audio file by ID. Returns `true` if it existed. */
  deleteAudio(id: string, scopeId?: string): Promise<boolean>;
  /** List all stored audio entries. When scopeId is provided, only scoped entries are returned. */
  listAudio(scopeId?: string): Promise<AudioEntry[]>;
  /** Remove audio entries older than `maxAgeMs` milliseconds. Returns count of deleted entries. */
  cleanupOlderThan(maxAgeMs: number, scopeId?: string): Promise<number>;
}
