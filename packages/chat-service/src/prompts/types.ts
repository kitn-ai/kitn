export interface RegistryItem {
  name: string;
  type: string;
  description: string;
  registryDependencies?: string[];
}

export interface GlobalRegistryEntry {
  namespace: string;
  url: string;
  items: RegistryItem[];
}

export interface PromptContext {
  registryIndex: RegistryItem[];
  installed: string[];
  globalRegistryIndex?: GlobalRegistryEntry[];
}
