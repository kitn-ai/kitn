import type { RegistryItem, RegistryIndex } from "./schema.js";
import type { RegistryEntry } from "../utils/config.js";

type TypeDir = "agents" | "tools" | "skills" | "storage" | "package" | "crons";
type FetchFn = (url: string) => Promise<RegistryItem>;
type RegistryValue = string | RegistryEntry;

function urlOf(entry: RegistryValue): string {
  return typeof entry === "string" ? entry : entry.url;
}

export class RegistryFetcher {
  private registries: Record<string, RegistryValue>;
  private cache = new Map<string, Promise<RegistryItem>>();
  private fetchFn: FetchFn;

  constructor(registries: Record<string, RegistryValue>, fetchFn?: FetchFn) {
    this.registries = registries;
    this.fetchFn = fetchFn ?? this.defaultFetch;
  }

  resolveUrl(name: string, typeDir: TypeDir, namespace = "@kitn", version?: string): string {
    const entry = this.registries[namespace];
    if (!entry) throw new Error(`No registry configured for ${namespace}`);
    const template = urlOf(entry);
    const fileName = version ? `${name}@${version}` : name;
    return template.replace("{name}", fileName).replace("{type}", typeDir);
  }

  async fetchItem(name: string, typeDir: TypeDir, namespace = "@kitn", version?: string): Promise<RegistryItem> {
    const url = this.resolveUrl(name, typeDir, namespace, version);
    if (!this.cache.has(url)) {
      this.cache.set(url, this.fetchFn(url));
    }
    return this.cache.get(url)!;
  }

  async fetchIndex(namespace = "@kitn"): Promise<RegistryIndex> {
    const entry = this.registries[namespace];
    if (!entry) throw new Error(`No registry configured for ${namespace}`);
    const template = urlOf(entry);
    const baseUrl = template.replace("{type}/{name}.json", "registry.json");
    const res = await fetch(baseUrl);
    if (!res.ok) throw new Error(`Failed to fetch registry index: ${res.statusText}`);
    return res.json();
  }

  private async defaultFetch(url: string): Promise<RegistryItem> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
    return res.json();
  }
}
