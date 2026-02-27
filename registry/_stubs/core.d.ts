/**
 * Minimal type stubs for @kitn/core self-registration API.
 * Used for type-checking registry components.
 */
import type { z } from "zod";

export interface AgentSelfRegConfig {
  name: string;
  description: string;
  system: string;
  tools: Record<string, any>;
  format?: "json" | "sse";
}

export interface ToolSelfRegConfig {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  tool: any;
  directExecute?: (input: any) => Promise<any>;
  category?: string;
}

export function registerAgent(config: AgentSelfRegConfig): void;
export function registerTool(config: ToolSelfRegConfig): void;
