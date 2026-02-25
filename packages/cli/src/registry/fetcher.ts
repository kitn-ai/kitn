import type { RegistryItem, RegistryIndex } from "./schema.js";

type TypeDir = "agents" | "tools" | "skills" | "storage" | "package";
type FetchFn = (url: string) => Promise<RegistryItem>;

export class RegistryFetcher {
  private registries: Record<string, string>;
  private cache = new Map<string, Promise<RegistryItem>>();
  private fetchFn: FetchFn;

  constructor(registries: Record<string, string>, fetchFn?: FetchFn) {
    this.registries = registries;
    this.fetchFn = fetchFn ?? this.defaultFetch;
  }

  resolveUrl(name: string, typeDir: TypeDir): string {
    const template = this.registries["@kitn"];
    if (!template) throw new Error("No @kitn registry configured");
    return template.replace("{name}", name).replace("{type}", typeDir);
  }

  async fetchItem(name: string, typeDir: TypeDir): Promise<RegistryItem> {
    const url = this.resolveUrl(name, typeDir);
    if (!this.cache.has(url)) {
      this.cache.set(url, this.fetchFn(url));
    }
    return this.cache.get(url)!;
  }

  async fetchIndex(): Promise<RegistryIndex> {
    const template = this.registries["@kitn"];
    if (!template) throw new Error("No @kitn registry configured");
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
