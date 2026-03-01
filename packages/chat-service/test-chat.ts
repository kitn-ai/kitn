/**
 * kitn chat service — 3-model test suite
 * Aligned with docs/chat-v2-test-scenarios.md
 *
 * Usage: bun test-chat.ts [model-filter]
 *   e.g. bun test-chat.ts deepseek
 */

const SERVICE = "http://localhost:4002";
const MODEL_FILTER = Bun.argv[2]?.toLowerCase();

// Minimal registry for context
const REGISTRY_INDEX = [
  { name: "weather-tool", type: "kitn:tool", description: "Get weather data" },
  { name: "weather-agent", type: "kitn:agent", description: "Weather assistant", registryDependencies: ["weather-tool"] },
  { name: "hackernews-tool", type: "kitn:tool", description: "Fetch HN stories" },
  { name: "hackernews-agent", type: "kitn:agent", description: "HN assistant", registryDependencies: ["hackernews-tool"] },
  { name: "web-search-tool", type: "kitn:tool", description: "Search the web" },
  { name: "web-search-agent", type: "kitn:agent", description: "Web search assistant", registryDependencies: ["web-search-tool"] },
  { name: "memory-store", type: "kitn:storage", description: "Persistent memory" },
  { name: "memory-agent", type: "kitn:agent", description: "Memory assistant", registryDependencies: ["memory-store"] },
  { name: "cron-tools", type: "kitn:tool", description: "Cron management tools" },
  { name: "cron-manager-agent", type: "kitn:agent", description: "Schedule tasks", registryDependencies: ["cron-tools"] },
  { name: "upstash-scheduler", type: "kitn:cron", description: "Upstash QStash scheduler" },
  { name: "mcp-server", type: "kitn:package", description: "Expose as MCP server" },
  { name: "hono", type: "kitn:package", description: "Hono HTTP adapter" },
];

const INSTALLED = ["weather-tool", "weather-agent"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Expectation =
  | { tool: string }        // expects a specific tool call
  | { tool: "any" }         // expects any tool call
  | { text: true }          // expects plain text (no tool calls, not rejected)
  | { rejected: true };     // expects guard rejection

interface TestCase {
  label: string;
  message: string;
  expect: Expectation;
  note?: string;
}

interface ChatResponse {
  message: { content: string; toolCalls?: Array<{ name: string; input: unknown }> };
  usage: { inputTokens: number; outputTokens: number };
  rejected?: boolean;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function sendChat(model: string, message: string): Promise<ChatResponse> {
  const payload = {
    messages: [{ role: "user", content: message }],
    metadata: { registryIndex: REGISTRY_INDEX, installed: INSTALLED },
    model,
  };
  const res = await fetch(`${SERVICE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

interface Result {
  model: string;
  label: string;
  pass: boolean;
  detail?: string;
  note?: string;
}

async function runTest(model: string, tc: TestCase): Promise<Result> {
  let resp: ChatResponse;
  try {
    resp = await sendChat(model, tc.message);
  } catch (err: any) {
    return { model, label: tc.label, pass: false, detail: `Request failed: ${err.message}`, note: tc.note };
  }

  const toolNames = (resp.message.toolCalls ?? []).map((t) => t.name);
  const rejected = !!resp.rejected;
  const hasTools = toolNames.length > 0;
  const text = resp.message.content?.slice(0, 120) ?? "";

  let pass = false;
  let detail: string | undefined;

  const exp = tc.expect;

  if ("rejected" in exp) {
    pass = rejected;
    if (!pass) detail = `expected rejection, got: tools=[${toolNames}] text="${text}"`;
  } else if ("text" in exp) {
    pass = !hasTools && !rejected && text.length > 0;
    if (!pass) detail = `expected plain text, got: tools=[${toolNames}] rejected=${rejected}`;
  } else if ("tool" in exp) {
    if (exp.tool === "any") {
      pass = hasTools;
      if (!pass) detail = `expected any tool call, got: text="${text}"`;
    } else {
      pass = toolNames.includes(exp.tool);
      if (!pass) detail = `expected tool=${exp.tool}, got: tools=[${toolNames}] text="${text}"`;
    }
  }

  return { model, label: tc.label, pass, detail, note: tc.note };
}

// ---------------------------------------------------------------------------
// Test cases (aligned with docs/chat-v2-test-scenarios.md)
// ---------------------------------------------------------------------------

const TESTS: TestCase[] = [
  // --- Core Workflows ---
  { label: "#1  add hackernews-agent",                  message: "Add hackernews-agent",                                       expect: { tool: "createPlan" } },
  { label: "#2  add with dependency resolution",        message: "Add the hackernews agent and its dependencies",              expect: { tool: "createPlan" } },
  { label: "#3  remove installed component",            message: "Remove the weather tool",                                    expect: { tool: "createPlan" } },
  { label: "#7  link tool to agent",                    message: "Link the cron-tools to the weather-agent",                   expect: { tool: "createPlan" } },
  { label: "#9  create custom tool",                    message: "Create a sentiment analysis tool",                           expect: { tool: "createPlan" } },
  { label: "#13 add memory-agent + memory-store",       message: "Add the memory-agent and memory-store",                     expect: { tool: "createPlan" } },
  { label: "#17 web search capabilities",               message: "I want to add web search capabilities",                     expect: { tool: "createPlan" } },
  { label: "#45 expose via MCP",                        message: "Set up MCP server so I can use my tools in Claude",         expect: { tool: "createPlan" } },

  // --- Clarification ---
  { label: "#31 vague: build an agent",                 message: "I want to build an agent",                                  expect: { tool: "askUser" } },
  { label: "#34 set up AI model",                       message: "I want to set up my AI model",                              expect: { tool: "askUser" } },
  { label: "#41 configure API key",                     message: "Configure OpenAI API key",                                  expect: { tool: "updateEnv" } },
  { label: "#42 configure BRAVE_API_KEY",               message: "Configure my BRAVE_API_KEY for web search",                 expect: { tool: "updateEnv" } },

  // --- Informational → plain text ---
  { label: "#23 what components are available",         message: "What components are available?",                            expect: { text: true } },
  { label: "#24 what tools does my project have",       message: "What tools does my project currently have?",               expect: { text: true } },
  { label: "#25 what is currently installed",           message: "What's currently installed in my project?",                expect: { text: true } },
  { label: "#29 how do I get started",                  message: "How do I get started with kitn?",                          expect: { tool: "askUser" }, note: "asking what they want to build is correct" },

  // --- Off-topic → rejected ---
  { label: "#70 off-topic: write a poem",               message: "Write me a poem",                                           expect: { rejected: true } },
  { label: "#71 off-topic: quantum physics",            message: "Explain quantum physics",                                   expect: { rejected: true } },
  { label: "#73 off-topic: React app",                  message: "Build me a React app",                                     expect: { rejected: true } },
  { label: "#76 off-topic: todo app",                   message: "Build a todo app",                                          expect: { rejected: true } },

  // --- Edge cases ---
  { label: "#79 component not in registry → create",   message: "Add the compact-agent for conversation management",         expect: { tool: "createPlan" }, note: "not in registry → create action" },
  { label: "#81 all caps input",                        message: "ADD A HACKERNEWS AGENT",                                   expect: { tool: "createPlan" } },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const MODELS = [
  "deepseek/deepseek-chat-v3-0324",
  "openai/gpt-4o-mini",
  "z-ai/glm-4.7",
] as const;

const activeModels = MODEL_FILTER
  ? MODELS.filter((m) => m.toLowerCase().includes(MODEL_FILTER))
  : MODELS;

if (activeModels.length === 0) {
  console.error(`No models match filter "${MODEL_FILTER}". Available: ${MODELS.join(", ")}`);
  process.exit(1);
}

const allResults: Result[] = [];
let totalPass = 0;
let totalFail = 0;

const cols = 52;
console.log("━".repeat(cols));
console.log(" kitn chat — model test suite");
console.log(`  ${TESTS.length} scenarios × ${activeModels.length} model(s) = ${TESTS.length * activeModels.length} tests`);
console.log("━".repeat(cols));
console.log();

for (const model of activeModels) {
  const shortModel = model.split("/").pop()!;
  console.log(`▶ ${shortModel}`);

  let modelPass = 0;
  let modelFail = 0;

  for (const tc of TESTS) {
    process.stdout.write(`  · ${tc.label.padEnd(44)}`);
    const result = await runTest(model, tc);
    allResults.push(result);

    if (result.pass) {
      modelPass++;
      totalPass++;
      console.log("✓");
    } else {
      modelFail++;
      totalFail++;
      console.log("✗");
      if (result.detail) console.log(`    → ${result.detail}`);
      if (result.note)   console.log(`    ℹ ${result.note}`);
    }
  }

  console.log(`  ${modelPass}/${TESTS.length} passed\n`);
}

console.log("━".repeat(cols));
console.log(` Results: ${totalPass} passed, ${totalFail} failed`);
console.log("━".repeat(cols));

if (totalFail > 0) {
  console.log("\nFailures:");
  for (const model of activeModels) {
    const shortModel = model.split("/").pop()!;
    const failures = allResults.filter((r) => r.model === model && !r.pass);
    if (failures.length === 0) continue;
    console.log(`\n  ${shortModel} (${failures.length}):`);
    for (const f of failures) {
      console.log(`    ✗ ${f.label}`);
      if (f.detail) console.log(`      ${f.detail}`);
    }
  }
}

process.exit(totalFail > 0 ? 1 : 0);
