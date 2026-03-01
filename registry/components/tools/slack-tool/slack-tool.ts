import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

async function slack(method: string, body: Record<string, unknown>) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN environment variable is required");
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return data;
}

export const slackSendTool = tool({
  description: "Send a message to a Slack channel",
  inputSchema: z.object({
    channel: z.string().describe("Channel ID or name (e.g. #general or C01234)"),
    text: z.string().describe("Message text (supports Slack mrkdwn format)"),
    threadTs: z.string().optional().describe("Thread timestamp to reply in a thread"),
  }),
  execute: async ({ channel, text, threadTs }) => {
    const data = await slack("chat.postMessage", { channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) });
    return { ok: true, channel: data.channel, ts: data.ts };
  },
});

export const slackChannelsTool = tool({
  description: "List Slack channels in the workspace",
  inputSchema: z.object({
    limit: z.number().min(1).max(200).default(20).describe("Number of channels to return"),
    excludeArchived: z.boolean().default(true),
  }),
  execute: async ({ limit, excludeArchived }) => {
    const data = await slack("conversations.list", { limit, exclude_archived: excludeArchived });
    return { channels: data.channels.map((c: any) => ({ id: c.id, name: c.name, topic: c.topic?.value, memberCount: c.num_members })) };
  },
});

registerTool({ name: "slack-send", description: "Send a message to a Slack channel", inputSchema: z.object({ channel: z.string(), text: z.string(), threadTs: z.string().optional() }), tool: slackSendTool });
registerTool({ name: "slack-channels", description: "List Slack channels", inputSchema: z.object({ limit: z.number().default(20), excludeArchived: z.boolean().default(true) }), tool: slackChannelsTool });
