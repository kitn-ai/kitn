import type { z } from "zod";
import type { ToolExample } from "../lib/tool-examples.js";

export interface ToolRegistration {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  // AI SDK tool type is opaque and not directly expressible — `any` required here
  tool: any;
  directExecute?: (input: any) => Promise<any>;
  category?: string;
  /** Structured examples for improved tool use accuracy */
  examples?: ToolExample[];
}

export class ToolRegistry {
  private tools = new Map<string, ToolRegistration>();

  register(registration: ToolRegistration) {
    this.tools.set(registration.name, registration);
  }

  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name);
  }

  list(): ToolRegistration[] {
    return [...this.tools.values()];
  }

  async execute(name: string, input: unknown): Promise<unknown> {
    const registration = this.tools.get(name);
    if (!registration) {
      throw new Error(`Tool not found: ${name}`);
    }
    if (registration.directExecute) {
      return registration.directExecute(input);
    }
    return registration.tool.execute!(input, { toolCallId: "direct" } as any);
  }
}
