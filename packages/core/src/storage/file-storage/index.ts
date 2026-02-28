import { resolve } from "node:path";
import type { StorageProvider, CronStore } from "../interfaces.js";
import { createConversationStore } from "./conversation-store.js";
import { createMemoryStore } from "./memory-store.js";
import { createSkillStore } from "./skill-store.js";
import { createTaskStore } from "./task-store.js";
import { createPromptStore } from "./prompt-store.js";
import { createAudioStore } from "./audio-store.js";
import { createCommandStore } from "./command-store.js";

export interface FileStorageOptions {
  /** Base directory for all data files (e.g. "./data") */
  dataDir: string;
}

// Stub CronStore — replaced by Task 3 (file-based CronStore)
function createStubCronStore(): CronStore {
  const notImplemented = () => {
    throw new Error("File-based CronStore not yet implemented");
  };
  return {
    create: notImplemented,
    get: notImplemented,
    list: notImplemented,
    update: notImplemented,
    delete: notImplemented,
    addExecution: notImplemented,
    listExecutions: notImplemented,
    updateExecution: notImplemented,
    getDueJobs: notImplemented,
  };
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
    commands: createCommandStore(dataDir),
    crons: createStubCronStore(),
  };
}
