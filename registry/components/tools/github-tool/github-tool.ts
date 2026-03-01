import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

const API = "https://api.github.com";

async function gh(path: string, method = "GET", body?: unknown) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN environment variable is required");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
}

export const githubSearchTool = tool({
  description: "Search GitHub repositories, issues, or code",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    type: z.enum(["repositories", "issues", "code"]).default("repositories"),
    perPage: z.number().min(1).max(30).default(5),
  }),
  execute: async ({ query, type, perPage }) => {
    const data = await gh(`/search/${type}?q=${encodeURIComponent(query)}&per_page=${perPage}`);
    return { totalCount: data.total_count, items: data.items.map((i: any) => ({ name: i.full_name ?? i.name, url: i.html_url, description: i.description ?? i.title ?? "" })) };
  },
});

export const githubIssuesTool = tool({
  description: "List or create issues in a GitHub repository",
  inputSchema: z.object({
    action: z.enum(["list", "create"]),
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    title: z.string().optional().describe("Issue title (for create)"),
    body: z.string().optional().describe("Issue body (for create)"),
    state: z.enum(["open", "closed", "all"]).default("open"),
    perPage: z.number().min(1).max(30).default(10),
  }),
  execute: async ({ action, owner, repo, title, body, state, perPage }) => {
    if (action === "create") {
      if (!title) throw new Error("title is required to create an issue");
      return gh(`/repos/${owner}/${repo}/issues`, "POST", { title, body });
    }
    return gh(`/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}`);
  },
});

export const githubFileTool = tool({
  description: "Get the contents of a file from a GitHub repository",
  inputSchema: z.object({
    owner: z.string(), repo: z.string(),
    path: z.string().describe("File path within the repo"),
    ref: z.string().optional().describe("Branch, tag, or commit SHA"),
  }),
  execute: async ({ owner, repo, path, ref }) => {
    const data = await gh(`/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${ref}` : ""}`);
    const content = data.encoding === "base64" ? atob(data.content.replace(/\n/g, "")) : data.content;
    return { path: data.path, size: data.size, content, sha: data.sha };
  },
});

registerTool({ name: "github-search", description: "Search GitHub repositories, issues, or code", inputSchema: z.object({ query: z.string(), type: z.enum(["repositories", "issues", "code"]).default("repositories"), perPage: z.number().default(5) }), tool: githubSearchTool });
registerTool({ name: "github-issues", description: "List or create issues in a GitHub repository", inputSchema: z.object({ action: z.enum(["list", "create"]), owner: z.string(), repo: z.string(), title: z.string().optional(), body: z.string().optional(), state: z.enum(["open", "closed", "all"]).default("open"), perPage: z.number().default(10) }), tool: githubIssuesTool });
registerTool({ name: "github-file", description: "Get the contents of a file from a GitHub repository", inputSchema: z.object({ owner: z.string(), repo: z.string(), path: z.string(), ref: z.string().optional() }), tool: githubFileTool });
