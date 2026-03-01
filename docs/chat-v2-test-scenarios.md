# kitn Chat v2 — Test Scenarios

Test scenarios used to validate the kitn chat assistant across multiple models (DeepSeek, GPT-4o-mini, GLM-4.7) via OpenRouter.

## Models Tested

| Model | OpenRouter ID |
|-------|---------------|
| DeepSeek Chat v3 | `deepseek/deepseek-chat-v3-0324` |
| GPT-4o-mini | `openai/gpt-4o-mini` |
| GLM-4.7 | `z-ai/glm-4.7` |

## Test Categories

### 1. Core Workflows (add, create, remove, update, link, unlink)

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 1 | "Add hackernews-agent" | `createPlan` with `add hackernews-tool` (dependency) + `add hackernews-agent` |
| 2 | "Add the hackernews agent and its dependencies" | Same as above — auto-resolve `registryDependencies` |
| 3 | "Remove the weather tool" | `createPlan` with `remove weather-tool` |
| 4 | "Remove weather-agent from my project" | `createPlan` with `remove weather-agent` |
| 5 | "Update core to the latest version" | `createPlan` with `update core` |
| 6 | "Update the hono adapter" | `createPlan` with `update hono` |
| 7 | "Link the cron-tools to the weather-agent" | `createPlan` with `link` step |
| 8 | "Unlink weather-tool from weather-agent" | `createPlan` with `unlink` step |
| 9 | "Create a sentiment analysis tool" | `createPlan` with `create` type=tool |
| 10 | "Create a Jira integration tool" | `createPlan` with `create` type=tool |
| 11 | "Create a data pipeline agent that fetches, transforms, and stores data" | `createPlan` with `create` type=agent |
| 12 | "Create a code-review agent that analyzes PRs using GitHub API" | `createPlan` with `create` for agent + tool |
| 13 | "Add the memory-agent and memory-store" | `createPlan` with both add steps |
| 14 | "Add all the skills to my project" | `createPlan` with 5 `add` steps (all skills) |
| 15 | "Add fact-checking and step-by-step reasoning skills" | `createPlan` with 2 add steps |
| 16 | "Add the knowledge-agent for movie recommendations" | `createPlan` with dependency (`movies-tool`) |

### 2. Multi-Component & Complex Plans

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 17 | "I want to add web search capabilities" | Plan with web-search-tool + web-search-agent + links |
| 18 | "Add web-search-agent and link it to the supervisor" | Plan with add + link steps |
| 19 | "Help me set up a supervisor that manages weather and hackernews agents" | Multi-step plan with adds + links |
| 20 | "I need to set up a multi-agent system with a supervisor" | Plan or askUser for clarification |
| 21 | "Add the ELI5 and pros-and-cons skills to weather-agent" | Plan with 2 adds + 2 links |
| 22 | "Switch to the Elysia adapter" | Plan with `remove hono` + `add elysia` |

### 3. Informational Queries

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 23 | "What components are available?" | Text listing registry components |
| 24 | "What tools does my project currently have?" | Text from metadata.installed |
| 25 | "What's currently installed in my project?" | Text from metadata.installed |
| 26 | "What models can I use with kitn?" | Text listing model providers |
| 27 | "What's the difference between hono and elysia adapters?" | Comparison text |
| 28 | "What cron schedulers are available?" | Text listing 4 schedulers |
| 29 | "How do I get started with kitn?" | Getting-started guidance text |
| 30 | "Can I use kitn with Redis for storage?" | Text explaining pluggable storage |

### 4. Clarification & askUser Queries

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 31 | "I want to build an agent" (vague) | `askUser` with agent type options |
| 32 | "I want to build a customer support bot" | `askUser` or plan for agent creation |
| 33 | "Create a new tool for my project" | `askUser` for tool type clarification |
| 34 | "I want to set up my AI model" | `askUser` with model provider options |
| 35 | "Help me configure my project" | `askUser` with configuration categories |
| 36 | "I need storage for my agents" | `askUser` with storage component options |
| 37 | "I want to add some skills to improve my agents" | `askUser` or show available skills |
| 38 | "Set up web search with a custom provider" | `askUser` for provider choice |
| 39 | "I want to switch to a different model provider" | `askUser` with provider options |
| 40 | "Create a RAG agent that uses embeddings and vector search" | `askUser` for requirements |

### 5. Configuration & Environment

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 41 | "Configure OpenAI API key" | `updateEnv` with key `OPENAI_API_KEY` |
| 42 | "Configure my BRAVE_API_KEY for web search" | `updateEnv` with key `BRAVE_API_KEY` |
| 43 | "I want to deploy to Vercel — which scheduler?" | `askUser` with scheduler options |

### 6. Adapter & Package Queries

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 44 | "I want to expose my API" | Allow — relates to adapter/server setup |
| 45 | "I want to expose my agents via MCP" | `createPlan` with `add mcp-server` |
| 46 | "Set up MCP server so I can use my tools in Claude" | `createPlan` with `add mcp-server` |
| 47 | "I need to add OpenAPI documentation to my API" | `createPlan` with `add hono-openapi` |
| 48 | "Install the hono adapter" | `createPlan` with `add hono` |
| 49 | "Switch to elysia" | `createPlan` with adapter swap |

### 7. Scheduling & Cron Queries

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 50 | "I want to add scheduling to my project" | Allow — present scheduler options |
| 51 | "Set up scheduled tasks that check weather every hour" | Plan with cron-tools + scheduler |
| 52 | "I want to add cron scheduling — what options do I have?" | Text listing schedulers |
| 53 | "Add a cron schedule" | Plan or askUser for scheduler choice |

### 8. Database & Storage Queries

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 54 | "Set up a database" | Allow — storage-related |
| 55 | "I want postgres storage" | Plan for custom storage creation |
| 56 | "Configure redis for memory" | Plan for custom storage creation |
| 57 | "Add a Postgres conversation store" | `createPlan` with `create` storage |
| 58 | "Add the conversation-store for persistent chat history" | `createPlan` with `add conversation-store` |

### 9. Model & Provider Queries

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 59 | "Which model should I use" | `askUser` with model options |
| 60 | "Configure openai provider" | Config guidance or askUser |
| 61 | "Switch to anthropic" | Config guidance |
| 62 | "Use openrouter for my agent" | Config guidance |
| 63 | "I want to use the Anthropic Claude model" | Config guidance or askUser |

### 10. Monitoring & Advanced

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 64 | "Set up monitoring" | Allow — monitoring-related |
| 65 | "Add a notification system" | Plan or askUser |
| 66 | "I want lifecycle hooks to log all agent activity" | Plan for custom hook creation |
| 67 | "Set up human-in-the-loop approval for my weather agent" | Plan or askUser |
| 68 | "I want to set up a notification agent that monitors HN" | Plan with multiple components |
| 69 | "Configure background job processing" | Allow — job-related |

### 11. Off-Topic Rejection

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 70 | "Write me a poem" | Rejected |
| 71 | "Explain quantum physics" | Rejected |
| 72 | "What is the meaning of life" | Rejected |
| 73 | "Build me a React app" | Rejected |
| 74 | "Create a landing page" | Rejected |
| 75 | "Tell me a joke" | Rejected |
| 76 | "Build a todo app" | Rejected |
| 77 | "Write me a poem about clouds" | Rejected |

### 12. Edge Cases

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 78 | "Link hackernews-tool to weather-agent" (cross-domain link) | `createPlan` with link — agent allows arbitrary links |
| 79 | "Add the compact-agent for conversation management" | `createPlan` with `add compact-agent` |
| 80 | "Set up the taskboard agent for project management" | `createPlan` or askUser |
| 81 | "ADD A WEATHER AGENT" (all caps) | Allow — case insensitive |
| 82 | "What Can You Do" (mixed case) | Allow — case insensitive |

### 13. Guard-Specific Tests (keyword fast-path)

| # | Scenario | Expected | Keyword Match? |
|---|----------|----------|----------------|
| 83 | "add a weather agent" | Allow | Yes (agent) |
| 84 | "what can you do" | Allow | Yes (what can) |
| 85 | "help" | Allow | Yes (help) |
| 86 | "set up a webhook" | Allow | Yes (webhook) |
| 87 | "configure my server" | Allow | Yes (server) |
| 88 | "create a chatbot" | Allow | Yes (bot) |
| 89 | "add a background task" | Allow | Yes (task) |
| 90 | "I want to add scheduling" | Allow | Yes (scheduling) |
| 91 | "install something" | Reject | No component keyword |
| 92 | "delete everything" | Reject | No component keyword |

### 14. Guard-Specific Tests (LLM classifier fallback)

These queries don't match keywords but the LLM classifier correctly handles them:

| # | Scenario | Expected | LLM Category |
|---|----------|----------|--------------|
| 93 | "I want to build a customer support system" | Allow | agent |
| 94 | "I want to deploy my project to production" | Allow | config |
| 95 | "set up human-in-the-loop approval" | Allow | agent |
| 96 | "write me a poem about clouds" | Reject | off-topic |
| 97 | "explain quantum physics to me" | Reject | off-topic |
| 98 | "build me a React app" | Reject | off-topic |

### 15. File-Exists Handling (CLI create flow)

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 99 | `kitn create agent sentiment-agent` when file exists | Prompt: "File already exists — overwrite?" |
| 100 | User confirms overwrite | File is overwritten with fresh scaffold |
| 101 | User declines overwrite | Skipped — no changes, no crash |
| 102 | Chat flow creates component that already exists | Auto-overwrites (user already confirmed plan) |

## Cross-Model Consistency Findings

From testing the same scenarios across all 3 models:

| Behavior | Consistency |
|----------|-------------|
| Guard pass/reject | High — keyword-based, model-independent |
| askUser for vague queries | High — DeepSeek is most consistent |
| createPlan structure | Medium — all produce valid plans but differ in step count |
| Dependency resolution | Medium — some models miss `registryDependencies` |
| Tool call count | Low — GPT-4o-mini sometimes fires duplicate tool calls |

## Known Model-Specific Issues

### GPT-4o-mini
- Sometimes fires multiple `createPlan` or `askUser` calls in a single response
- Addressed by "Call createPlan exactly once" in system prompt

### DeepSeek
- Most reliable at using `askUser` for clarification before planning
- Occasionally generates `remove` plans for non-installed components

### GLM-4.7
- Model ID on OpenRouter is `z-ai/glm-4.7` (not `zhipu/glm-4-plus`)
- Behavior comparable to DeepSeek when model ID is correct
