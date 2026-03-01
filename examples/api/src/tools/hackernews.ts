import { tool } from "ai";
import { z } from "zod";
import type { AIPluginInstance } from "@kitnai/hono-openapi-adapter";

const HN_BASE = "https://hacker-news.firebaseio.com/v0";

export const hackernewsTopStoriesTool = tool({
  description:
    "Fetches the top stories from Hacker News. Returns a list of stories with title, URL, score, author, and comment count.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(10)
      .describe("Number of top stories to fetch (1-30, default 10)"),
  }),
  execute: async ({ limit }) => {
    const idsRes = await fetch(`${HN_BASE}/topstories.json`);
    if (!idsRes.ok) {
      throw new Error(`Failed to fetch top stories: ${idsRes.statusText}`);
    }
    const ids: number[] = await idsRes.json();
    const topIds = ids.slice(0, limit);

    const stories = await Promise.all(
      topIds.map(async (id) => {
        const itemRes = await fetch(`${HN_BASE}/item/${id}.json`);
        if (!itemRes.ok) {
          throw new Error(`Failed to fetch item ${id}: ${itemRes.statusText}`);
        }
        const item = await itemRes.json();
        return {
          id: item.id,
          title: item.title,
          url: item.url ?? null,
          score: item.score,
          by: item.by,
          time: new Date(item.time * 1000).toISOString(),
          descendants: item.descendants ?? 0,
        };
      }),
    );

    return { stories, count: stories.length };
  },
});

export const hackernewsStoryDetailTool = tool({
  description:
    "Fetches details for a specific Hacker News story by ID, including the top 5 comments.",
  inputSchema: z.object({
    storyId: z.number().int().describe("The Hacker News story ID to fetch"),
  }),
  execute: async ({ storyId }) => {
    const storyRes = await fetch(`${HN_BASE}/item/${storyId}.json`);
    if (!storyRes.ok) {
      throw new Error(`Failed to fetch story ${storyId}: ${storyRes.statusText}`);
    }
    const story = await storyRes.json();

    const commentIds: number[] = (story.kids ?? []).slice(0, 5);

    const topComments = await Promise.all(
      commentIds.map(async (id) => {
        const commentRes = await fetch(`${HN_BASE}/item/${id}.json`);
        if (!commentRes.ok) return null;
        const comment = await commentRes.json();
        return {
          id: comment.id,
          by: comment.by ?? null,
          text: comment.text ? comment.text.slice(0, 500) : null,
          time: comment.time ? new Date(comment.time * 1000).toISOString() : null,
        };
      }),
    );

    return {
      id: story.id,
      title: story.title,
      url: story.url ?? null,
      score: story.score,
      by: story.by,
      time: new Date(story.time * 1000).toISOString(),
      descendants: story.descendants ?? 0,
      text: story.text ?? null,
      topComments: topComments.filter(Boolean),
    };
  },
});

export function registerHackernewsTools(plugin: AIPluginInstance) {
  plugin.tools.register({
    name: "hackernewsTopStories",
    description:
      "Fetches the top stories from Hacker News with title, URL, score, author, and comment count.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(30).default(10),
    }),
    tool: hackernewsTopStoriesTool,
    directExecute: async (input) =>
      hackernewsTopStoriesTool.execute!(
        { limit: input.limit ?? 10 },
        { toolCallId: "direct" } as any,
      ),
    category: "news",
  });

  plugin.tools.register({
    name: "hackernewsStoryDetail",
    description:
      "Fetches details for a specific Hacker News story by ID, including the top 5 comments.",
    inputSchema: z.object({
      storyId: z.number().int(),
    }),
    tool: hackernewsStoryDetailTool,
    directExecute: async (input) =>
      hackernewsStoryDetailTool.execute!(
        { storyId: input.storyId },
        { toolCallId: "direct" } as any,
      ),
    category: "news",
  });
}
