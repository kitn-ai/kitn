export interface PairingData {
  userId: string;
  channelType: string;
  createdAt: number;
}

export class PairingManager {
  private pairings = new Map<string, PairingData>();
  private ttl: number; // milliseconds

  constructor(ttl?: number) {
    this.ttl = ttl ?? 5 * 60 * 1000; // 5 minutes default
  }

  /** Generate a random 6-character alphanumeric code (no O/0/I/1 for readability) */
  generateCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  /** Create a pairing code for a user + channel */
  createPairing(userId: string, channelType: string): string {
    const code = this.generateCode();
    this.pairings.set(code, { userId, channelType, createdAt: Date.now() });
    return code;
  }

  /** Validate a pairing code — returns data if valid, null if expired/unknown. Single-use. */
  validatePairing(code: string): PairingData | null {
    const normalized = code.toUpperCase();
    const pairing = this.pairings.get(normalized);
    if (!pairing) return null;

    // Check expiry
    if (Date.now() - pairing.createdAt > this.ttl) {
      this.pairings.delete(normalized);
      return null;
    }

    // Single-use: remove after validation
    this.pairings.delete(normalized);
    return pairing;
  }

  /** Clean up expired pairings */
  cleanup(): void {
    const now = Date.now();
    for (const [code, pairing] of this.pairings) {
      if (now - pairing.createdAt > this.ttl) {
        this.pairings.delete(code);
      }
    }
  }
}
