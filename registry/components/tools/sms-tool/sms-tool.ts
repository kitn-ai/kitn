import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const smsTool = tool({
  description: "Send an SMS message via Twilio",
  inputSchema: z.object({
    to: z.string().describe("Recipient phone number in E.164 format (+1234567890)"),
    body: z.string().max(1600).describe("Message body (max 1600 chars)"),
  }),
  execute: async ({ to, body }) => {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER;
    if (!sid || !token || !from) throw new Error("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are required");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    if (!res.ok) throw new Error(`Twilio API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { sid: data.sid, to: data.to, from: data.from, status: data.status };
  },
});

registerTool({ name: "sms-send", description: "Send an SMS message via Twilio", inputSchema: z.object({ to: z.string(), body: z.string().max(1600) }), tool: smsTool });
