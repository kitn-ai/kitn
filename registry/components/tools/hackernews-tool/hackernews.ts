import { tool } from "ai";
import { z } from "zod";

const HN_BASE = "https://hacker-news.firebaseio.com/v0";

export const hackernewsTopStoriesTool = tool({
  description:
    "Get the current top stories from Hacker News. Returns a list of stories with titles, scores, and URLs.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(30)
      .default(10)
      .describe("Number of top stories to return (max 30)"),
  }),
  execute: async ({ limit }) => {
    const response = await fetch(`${HN_BASE}/topstories.json`);
    if (!response.ok) throw new Error("Failed to fetch top stories");

    const ids: number[] = await response.json();
    const topIds = ids.slice(0, limit);

    const stories = await Promise.all(
      topIds.map(async (id) => {
        const res = await fetch(`${HN_BASE}/item/${id}.json`);
        if (!res.ok) return null;
        const item = await res.json();
        return {
          id: item.id,
          title: item.title,
          url: item.url ?? null,
          score: item.score,
          by: item.by,
          time: new Date(item.time * 1000).toISOString(),
          descendants: item.descendants ?? 0,
        };
      })
    );

    const validStories = stories.filter(Boolean);
    return { stories: validStories, count: validStories.length };
  },
});

export const hackernewsStoryDetailTool = tool({
  description:
    "Get detailed information about a specific Hacker News story by its ID, including top comments.",
  inputSchema: z.object({
    storyId: z.number().describe("The Hacker News story ID"),
  }),
  execute: async ({ storyId }) => {
    const response = await fetch(`${HN_BASE}/item/${storyId}.json`);
    if (!response.ok) throw new Error(`Failed to fetch story ${storyId}`);

    const story = await response.json();
    if (!story) throw new Error(`Story ${storyId} not found`);

    const commentIds = (story.kids ?? []).slice(0, 5);
    const comments = await Promise.all(
      commentIds.map(async (id: number) => {
        const res = await fetch(`${HN_BASE}/item/${id}.json`);
        if (!res.ok) return null;
        const item = await res.json();
        return {
          id: item.id,
          by: item.by,
          text: item.text?.slice(0, 500) ?? "",
          time: new Date(item.time * 1000).toISOString(),
        };
      })
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
      topComments: comments.filter(Boolean),
    };
  },
});
