import { readFile, writeFile, mkdir, rm, readdir } from "fs/promises";
import { join } from "path";

/** Subset of the keytar API we use — avoids a hard dependency on the native module. */
interface KeytarModule {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

/** Dynamic import of keytar — returns null when the native module is not installed. */
async function tryLoadKeytar(): Promise<KeytarModule | null> {
  try {
    // String indirection prevents bundlers/TS from resolving at compile time
    const mod = "keytar";
    return await import(/* webpackIgnore: true */ mod) as KeytarModule;
  } catch {
    return null;
  }
}

interface CredentialStoreOptions {
  useKeychain?: boolean;
  path: string;
}

export class CredentialStore {
  private useKeychain: boolean;
  private path: string;
  private static SERVICE = "kitnclaw";

  constructor(options: CredentialStoreOptions) {
    this.useKeychain = options.useKeychain ?? true;
    this.path = options.path;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.useKeychain) {
      const keytar = await tryLoadKeytar();
      if (keytar) {
        await keytar.setPassword(CredentialStore.SERVICE, key, value);
        return;
      }
    }
    await mkdir(this.path, { recursive: true });
    await writeFile(
      join(this.path, key),
      Buffer.from(value).toString("base64"),
      { mode: 0o600 },
    );
  }

  async get(key: string): Promise<string | null> {
    if (this.useKeychain) {
      const keytar = await tryLoadKeytar();
      if (keytar) {
        return await keytar.getPassword(CredentialStore.SERVICE, key);
      }
    }
    try {
      const encoded = await readFile(join(this.path, key), "utf-8");
      return Buffer.from(encoded, "base64").toString("utf-8");
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    if (this.useKeychain) {
      const keytar = await tryLoadKeytar();
      if (keytar) {
        await keytar.deletePassword(CredentialStore.SERVICE, key);
        return;
      }
    }
    try {
      await rm(join(this.path, key));
    } catch {
      // File doesn't exist — nothing to delete
    }
  }

  async list(): Promise<string[]> {
    if (this.useKeychain) {
      const keytar = await tryLoadKeytar();
      if (keytar) {
        const creds = await keytar.findCredentials(CredentialStore.SERVICE);
        return creds.map((c) => c.account);
      }
    }
    try {
      return await readdir(this.path);
    } catch {
      return [];
    }
  }
}
