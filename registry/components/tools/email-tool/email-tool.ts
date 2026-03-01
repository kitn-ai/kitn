import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const emailTool = tool({
  description: "Send an email via Resend API",
  inputSchema: z.object({
    from: z.string().describe("Sender email (must be verified domain in Resend)"),
    to: z.union([z.string(), z.array(z.string())]).describe("Recipient email(s)"),
    subject: z.string().describe("Email subject"),
    html: z.string().optional().describe("HTML body"),
    text: z.string().optional().describe("Plain text body"),
    replyTo: z.string().optional().describe("Reply-to email"),
  }),
  execute: async ({ from, to, subject, html, text, replyTo }) => {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY environment variable is required");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html, text, reply_to: replyTo }),
    });
    if (!res.ok) throw new Error(`Resend API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { id: data.id, from, to, subject };
  },
});

registerTool({ name: "email-send", description: "Send an email via Resend API", inputSchema: z.object({ from: z.string(), to: z.union([z.string(), z.array(z.string())]), subject: z.string(), html: z.string().optional(), text: z.string().optional(), replyTo: z.string().optional() }), tool: emailTool });
