import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig, readLock } from "../utils/config.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import type { ChatPlan, PlanStep } from "./chat-types.js";

const DEFAULT_SERVICE_URL = "https://chat.kitn.dev";

/**
 * Resolve the chat service URL.
 * Priority: KITN_CHAT_URL env var > config.chatService.url > default
 */
export function resolveServiceUrl(chatServiceConfig?: { url?: string }): string {
  if (process.env.KITN_CHAT_URL) {
    return process.env.KITN_CHAT_URL;
  }
  if (chatServiceConfig?.url) {
    return chatServiceConfig.url;
  }
  return DEFAULT_SERVICE_URL;
}

/**
 * Build the request payload for the chat service.
 */
export function buildRequestPayload(message: string, metadata: Record<string, unknown>) {
  return { message, metadata };
}

/**
 * Format a ChatPlan for display using picocolors.
 */
export function formatPlan(plan: ChatPlan): string {
  const lines: string[] = [plan.summary, ""];

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const num = `${i + 1}.`;
    const label = formatStepLabel(step);
    lines.push(`${num} ${label} - ${step.reason}`);
  }

  return lines.join("\n");
}

function formatStepLabel(step: PlanStep): string {
  switch (step.action) {
    case "add":
      return `Add ${pc.cyan(step.component!)}`;
    case "remove":
      return `Remove ${pc.red(step.component!)}`;
    case "create":
      return `Create ${pc.green(`${step.type}/${step.name}`)}`;
    case "link":
      return `Link ${pc.cyan(step.toolName!)} → ${pc.cyan(step.agentName!)}`;
    case "unlink":
      return `Unlink ${pc.red(step.toolName!)} from ${pc.cyan(step.agentName!)}`;
  }
}

export async function chatCommand(message: string | undefined): Promise<void> {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  if (!message) {
    p.log.error("Please provide a message. Usage: kitn chat \"add a weather tool\"");
    process.exit(1);
  }

  p.intro(pc.bold("kitn assistant"));

  // --- Gather context ---
  const s = p.spinner();
  s.start("Gathering project context...");

  let registryIndex: unknown;
  let installed: string[];

  try {
    const fetcher = new RegistryFetcher(config.registries);
    const indices = [];
    for (const namespace of Object.keys(config.registries)) {
      try {
        const index = await fetcher.fetchIndex(namespace);
        indices.push(index);
      } catch {
        // Skip failing registries
      }
    }
    registryIndex = indices;

    const lock = await readLock(cwd);
    installed = Object.keys(lock);
  } catch {
    s.stop(pc.red("Failed to gather context"));
    p.log.error("Could not read project context. Check your kitn.json and network connection.");
    process.exit(1);
  }

  s.stop("Context gathered");

  // --- Call service ---
  s.start("Thinking...");

  const serviceUrl = resolveServiceUrl(config.chatService);
  const payload = buildRequestPayload(message, { registryIndex, installed });

  let response: Response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (process.env.KITN_API_KEY) {
      headers["Authorization"] = `Bearer ${process.env.KITN_API_KEY}`;
    }

    response = await fetch(`${serviceUrl}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    s.stop(pc.red("Connection failed"));
    p.log.error(`Could not reach chat service at ${serviceUrl}. ${err.message ?? ""}`);
    process.exit(1);
  }

  if (!response.ok) {
    s.stop(pc.red("Request failed"));
    p.log.error(`Chat service returned ${response.status}: ${response.statusText}`);
    process.exit(1);
  }

  let data: { rejected?: boolean; text?: string; plan?: ChatPlan };
  try {
    data = await response.json();
  } catch {
    s.stop(pc.red("Invalid response"));
    p.log.error("Chat service returned an invalid response.");
    process.exit(1);
  }

  s.stop("Done");

  // --- Handle response ---
  if (data.rejected) {
    p.log.warn(data.text ?? "Request was rejected by the assistant.");
    p.outro("Try rephrasing your request.");
    return;
  }

  if (!data.plan) {
    p.log.info(data.text ?? "No actionable plan returned.");
    p.outro("Nothing to do.");
    return;
  }

  // Render plan
  p.log.message(formatPlan(data.plan));

  // --- Confirm ---
  const steps = data.plan.steps;
  const action = await p.select({
    message: "How would you like to proceed?",
    options: [
      { value: "all", label: "Yes, run all steps" },
      { value: "select", label: "Select which steps to run" },
      { value: "cancel", label: "Cancel" },
    ],
  });

  if (p.isCancel(action) || action === "cancel") {
    p.cancel("Cancelled.");
    return;
  }

  let selectedSteps: PlanStep[];

  if (action === "select") {
    const choices = await p.multiselect({
      message: "Select steps to run:",
      options: steps.map((step, i) => ({
        value: i,
        label: `${formatStepLabel(step)} - ${step.reason}`,
      })),
    });

    if (p.isCancel(choices)) {
      p.cancel("Cancelled.");
      return;
    }

    selectedSteps = (choices as number[]).map((i) => steps[i]);
  } else {
    selectedSteps = steps;
  }

  // --- Execute plan ---
  for (const step of selectedSteps) {
    s.start(`Running: ${formatStepLabel(step)}...`);

    try {
      switch (step.action) {
        case "add": {
          const { addCommand } = await import("./add.js");
          await addCommand([step.component!], { yes: true });
          break;
        }
        case "create": {
          const { createCommand } = await import("./create.js");
          await createCommand(step.type!, step.name!);
          break;
        }
        case "link": {
          const { linkCommand } = await import("./link.js");
          await linkCommand("tool", step.toolName, { to: step.agentName });
          break;
        }
        case "remove": {
          const { removeCommand } = await import("./remove.js");
          await removeCommand(step.component);
          break;
        }
        case "unlink": {
          const { unlinkCommand } = await import("./unlink.js");
          await unlinkCommand("tool", step.toolName, { from: step.agentName });
          break;
        }
      }
      s.stop(pc.green(`Done: ${formatStepLabel(step)}`));
    } catch (err: any) {
      s.stop(pc.red(`Failed: ${formatStepLabel(step)}`));
      p.log.error(err.message ?? "Unknown error");
    }
  }

  p.outro(pc.green("All done! Run your dev server to test the new components."));
}
