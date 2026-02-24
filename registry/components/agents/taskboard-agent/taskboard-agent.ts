import { tool } from "ai";
import { z } from "zod";

const SYSTEM_PROMPT = `You are a task board agent that manages a Kanban-style board with three columns: To Do, In Progress, and Done.

## Scope & Guardrails
You ONLY handle task board operations. Your sole purpose is creating, listing, moving, and deleting tasks.

If the user asks about ANYTHING unrelated to task management -- weather, coding help, general knowledge, recipes, math, conversation, etc. -- politely decline and redirect:
"I can only help with managing your task board. Try asking me to create, move, list, or delete tasks."

Do NOT answer off-topic questions, even if you know the answer. Do NOT engage in general conversation. Stay strictly within your domain.

## Task Operations

When the user asks to add or create a task:
1. Use the createTask tool -- it starts in To Do automatically
2. Confirm what was created

When the user asks to move, start, or complete a task:
1. If they refer to a task by name, first use listTasks to find its ID
2. Use updateTask with the correct status (todo, in-progress, or done)
3. Confirm the move

When the user asks to show, list, or display tasks:
1. Use listTasks (optionally filtered by status)
2. Format the results as a clear board with three columns: **To Do**, **In Progress**, **Done**

When the user asks to delete or remove a task:
1. If they refer to a task by name, first use listTasks to find its ID
2. Use deleteTask to remove it
3. Confirm the deletion

Always confirm what action was taken. Be concise and helpful.`;

/**
 * In-memory task store for demonstration purposes.
 * Replace with your own persistent storage backend.
 */
interface Task {
  id: string;
  title: string;
  status: "todo" | "in-progress" | "done";
  createdAt: string;
  updatedAt: string;
}

const taskStore = new Map<string, Task>();
let nextId = 1;

const createTaskTool = tool({
  description: "Create a new task on the board. It starts in the To Do column.",
  inputSchema: z.object({
    title: z.string().describe("The task title"),
  }),
  execute: async ({ title }) => {
    const id = String(nextId++);
    const now = new Date().toISOString();
    const task: Task = { id, title, status: "todo", createdAt: now, updatedAt: now };
    taskStore.set(id, task);
    return task;
  },
});

const listTasksTool = tool({
  description: "List all tasks, optionally filtered by status",
  inputSchema: z.object({
    status: z
      .enum(["todo", "in-progress", "done"])
      .optional()
      .describe("Filter by status (omit for all tasks)"),
  }),
  execute: async ({ status }) => {
    let tasks = [...taskStore.values()];
    if (status) tasks = tasks.filter((t) => t.status === status);
    return { tasks, count: tasks.length };
  },
});

const updateTaskTool = tool({
  description: "Update a task's title or status",
  inputSchema: z.object({
    id: z.string().describe("The task ID"),
    title: z.string().optional().describe("New title (optional)"),
    status: z
      .enum(["todo", "in-progress", "done"])
      .optional()
      .describe("New status (optional)"),
  }),
  execute: async ({ id, title, status }) => {
    const task = taskStore.get(id);
    if (!task) return { error: `Task ${id} not found` };
    if (title) task.title = title;
    if (status) task.status = status;
    task.updatedAt = new Date().toISOString();
    return task;
  },
});

const deleteTaskTool = tool({
  description: "Delete a task from the board",
  inputSchema: z.object({
    id: z.string().describe("The task ID to delete"),
  }),
  execute: async ({ id }) => {
    const deleted = taskStore.delete(id);
    return { deleted, id };
  },
});

export const TASKBOARD_AGENT_CONFIG = {
  system: SYSTEM_PROMPT,
  tools: {
    createTask: createTaskTool,
    listTasks: listTasksTool,
    updateTask: updateTaskTool,
    deleteTask: deleteTaskTool,
  },
};
