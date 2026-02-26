import type { CommandStore, CommandRegistration } from "../interfaces.js";

export function createCommandStore(): CommandStore {
  const store = new Map<string, CommandRegistration>();

  function key(name: string, scopeId?: string): string {
    return scopeId ? `${scopeId}:${name}` : `:${name}`;
  }

  function prefix(scopeId?: string): string {
    return scopeId ? `${scopeId}:` : `:`;
  }

  return {
    async list(scopeId?) {
      const p = prefix(scopeId);
      const results: CommandRegistration[] = [];
      for (const [k, v] of store) {
        if (k.startsWith(p)) results.push(v);
      }
      return results;
    },

    async get(name, scopeId?) {
      return store.get(key(name, scopeId));
    },

    async save(command, scopeId?) {
      store.set(key(command.name, scopeId), command);
    },

    async delete(name, scopeId?) {
      store.delete(key(name, scopeId));
    },
  };
}
