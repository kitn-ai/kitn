import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

async function stripe(path: string, method = "GET", body?: Record<string, string>) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY environment variable is required");
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  if (!res.ok) throw new Error(`Stripe API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export const stripeCustomersTool = tool({
  description: "List or search Stripe customers",
  inputSchema: z.object({
    email: z.string().optional().describe("Filter by customer email"),
    limit: z.number().min(1).max(100).default(10),
  }),
  execute: async ({ email, limit }) => {
    const params = new URLSearchParams({ limit: String(limit), ...(email ? { email } : {}) });
    const data = await stripe(`/customers?${params}`);
    return { customers: data.data.map((c: any) => ({ id: c.id, email: c.email, name: c.name, created: new Date(c.created * 1000).toISOString() })) };
  },
});

export const stripeBalanceTool = tool({
  description: "Get the current Stripe account balance",
  inputSchema: z.object({}),
  execute: async () => {
    const data = await stripe("/balance");
    return { available: data.available, pending: data.pending };
  },
});

registerTool({ name: "stripe-customers", description: "List or search Stripe customers", inputSchema: z.object({ email: z.string().optional(), limit: z.number().default(10) }), tool: stripeCustomersTool });
registerTool({ name: "stripe-balance", description: "Get the current Stripe account balance", inputSchema: z.object({}), tool: stripeBalanceTool });
