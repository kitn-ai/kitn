import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { TaskStore, Task } from "../interfaces.js";

export function createTaskStore(dataDir: string): TaskStore {
  const tasksFile = `${dataDir}/tasks.json`;

  let lock: Promise<void> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = lock;
    let result: Promise<T>;
    const next = prev
      .then(async () => { result = fn(); await result; })
      .catch(() => {});
    lock = next;
    return next.then(() => result!);
  }

  async function ensureDir() {
    if (!existsSync(dataDir)) await mkdir(dataDir, { recursive: true });
  }

  async function readTasks(): Promise<Task[]> {
    await ensureDir();
    if (!existsSync(tasksFile)) return [];
    const raw = await readFile(tasksFile, "utf-8");
    try { return JSON.parse(raw); } catch { return []; }
  }

  async function writeTasks(data: Task[]): Promise<void> {
    await ensureDir();
    await writeFile(tasksFile, JSON.stringify(data, null, 2));
  }

  function generateId(): string { return Date.now().toString(36); }

  return {
    createTask(title) {
      return withLock(async () => {
        const tasks = await readTasks();
        const now = new Date().toISOString();
        const task: Task = { id: generateId(), title, status: "todo", createdAt: now, updatedAt: now };
        tasks.push(task);
        await writeTasks(tasks);
        return task;
      });
    },

    async listTasks() { return readTasks(); },

    updateTask(id, updates) {
      return withLock(async () => {
        const tasks = await readTasks();
        const task = tasks.find((t) => t.id === id);
        if (!task) throw new Error(`Task not found: ${id}`);
        if (updates.title !== undefined) task.title = updates.title;
        if (updates.status !== undefined) task.status = updates.status;
        task.updatedAt = new Date().toISOString();
        await writeTasks(tasks);
        return task;
      });
    },

    deleteTask(id) {
      return withLock(async () => {
        const tasks = await readTasks();
        const index = tasks.findIndex((t) => t.id === id);
        if (index === -1) return false;
        tasks.splice(index, 1);
        await writeTasks(tasks);
        return true;
      });
    },
  };
}
