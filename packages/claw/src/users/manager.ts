export type UserRole = "operator" | "user" | "guest";

export interface UserConfig {
  role: UserRole;
  channels?: string[]; // Allowed channels (all if empty/undefined)
  denied?: string[]; // Tools denied for this user
}

/** Default tool restrictions per role */
const ROLE_DEFAULTS: Record<UserRole, { denied: string[] }> = {
  operator: { denied: [] },
  user: { denied: [] },
  guest: {
    denied: ["bash", "file-write", "file-delete", "create-tool", "create-agent"],
  },
};

export class UserManager {
  private users: Map<string, UserConfig>;
  private defaultRole: UserRole;

  constructor(users: Record<string, UserConfig>, defaultRole?: UserRole) {
    this.users = new Map(Object.entries(users));
    this.defaultRole = defaultRole ?? "guest";
  }

  /** Get user config, defaulting to guest for unknown users */
  getUser(userId: string): UserConfig {
    return this.users.get(userId) ?? { role: this.defaultRole };
  }

  /** Check if user can access a specific channel */
  canAccessChannel(userId: string, channelType: string): boolean {
    const user = this.getUser(userId);
    // Operators can access everything
    if (user.role === "operator") return true;
    // If no channel restrictions, allow all
    if (!user.channels || user.channels.length === 0) return true;
    return user.channels.includes(channelType);
  }

  /** Get denied tools for a user (merges role defaults + user-specific) */
  getDeniedTools(userId: string): string[] {
    const user = this.getUser(userId);
    const roleDenied = ROLE_DEFAULTS[user.role].denied;
    const userDenied = user.denied ?? [];
    return [...new Set([...roleDenied, ...userDenied])];
  }
}
