import { resolve } from "node:path";
import type { StorageProvider } from "../interfaces.js";
import { createConversationStore } from "./conversation-store.js";
import { createMemoryStore } from "./memory-store.js";
import { createSkillStore } from "./skill-store.js";
import { createTaskStore } from "./task-store.js";
import { createPromptStore } from "./prompt-store.js";
import { createAudioStore } from "./audio-store.js";

export interface FileStorageOptions {
  /** Base directory for all data files (e.g. "./data") */
  dataDir: string;
}

export function createFileStorage(options: FileStorageOptions): StorageProvider {
  const dataDir = resolve(options.dataDir);

  return {
    conversations: createConversationStore(dataDir),
    memory: createMemoryStore(dataDir),
    skills: createSkillStore(dataDir),
    tasks: createTaskStore(dataDir),
    prompts: createPromptStore(dataDir),
    audio: createAudioStore(dataDir),
  };
}
