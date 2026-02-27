# kitn Example API Server

A working REST API built with kitn, demonstrating agents, tools, an orchestrator, file-based storage, and optional voice support.

## What This Example Demonstrates

- Creating a `@kitn/routes` plugin with `createAIPlugin`
- Registering tools with both AI and direct-call execution
- Registering agents that use those tools
- Adding a guard function to reject certain inputs
- Setting up an orchestrator that routes queries to specialist agents
- File-based persistent storage for conversations, memories, skills, and prompt overrides
- API key authentication via `X-API-Key` header
- Automatic retry and conversation compaction configuration
- Optional voice (TTS/STT) providers

## Setup

1. Copy the environment file and fill in your keys:

```bash
cp .env.example .env
```

At minimum, set `OPENROUTER_API_KEY`. Everything else has working defaults.

2. Install dependencies from the monorepo root:

```bash
bun install
```

3. Start the dev server:

```bash
bun run dev
```

The server starts at `http://localhost:4000` by default. All API routes are mounted under `/api`.

## Agents

| Agent | Description | Tools |
|---|---|---|
| `general` | General-purpose assistant | `echo`, `getWeather`, `calculate` |
| `guarded` | Demonstrates input guards -- blocks messages containing "blocked" | `echo` |
| `orchestrator` | Automatically routes queries to the best specialist agent | (delegates to other agents) |

## Tools

| Tool | Category | Description |
|---|---|---|
| `echo` | utility | Echoes back the input message |
| `getWeather` | weather | Fetches current weather from Open-Meteo (no API key needed) |
| `calculate` | utility | Evaluates math expressions (`+`, `-`, `*`, `/`, `%`, `^`, parentheses) |

All tools support both AI-driven execution (when an agent decides to use them) and direct execution via `POST /api/tools/:toolName`.

## Example Curl Commands

Every request requires the `X-API-Key` header. The default key is `test`.

### List agents

```bash
curl http://localhost:4000/api/agents \
  -H "X-API-Key: test"
```

### Chat with the general agent (SSE streaming)

```bash
curl -N http://localhost:4000/api/agents/general \
  -H "X-API-Key: test" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the weather in Tokyo?"}'
```

### Chat with the general agent (JSON response)

```bash
curl http://localhost:4000/api/agents/general?format=json \
  -H "X-API-Key: test" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is 42 * 17?"}'
```

### Use the orchestrator

The orchestrator picks the best agent for the query automatically:

```bash
curl -N http://localhost:4000/api/agents/orchestrator \
  -H "X-API-Key: test" \
  -H "Content-Type: application/json" \
  -d '{"message": "Check the weather in Berlin"}'
```

### Continue a conversation

Pass a `conversationId` to maintain context across requests:

```bash
curl -N http://localhost:4000/api/agents/general \
  -H "X-API-Key: test" \
  -H "Content-Type: application/json" \
  -d '{"message": "Now compare that to New York", "conversationId": "my-session-1"}'
```

### Call a tool directly

Tools can be called without going through an agent:

```bash
curl http://localhost:4000/api/tools/calculate \
  -H "X-API-Key: test" \
  -H "Content-Type: application/json" \
  -d '{"expression": "2 ^ 10"}'
```

```bash
curl http://localhost:4000/api/tools/getWeather \
  -H "X-API-Key: test" \
  -H "Content-Type: application/json" \
  -d '{"location": "Paris"}'
```

### Test the guard

The guarded agent rejects messages containing the word "blocked":

```bash
curl http://localhost:4000/api/agents/guarded?format=json \
  -H "X-API-Key: test" \
  -H "Content-Type: application/json" \
  -d '{"message": "This is blocked content"}'
```

### List tools

```bash
curl http://localhost:4000/api/tools \
  -H "X-API-Key: test"
```

### Override an agent's system prompt

```bash
curl -X PATCH http://localhost:4000/api/agents/general \
  -H "X-API-Key: test" \
  -H "Content-Type: application/json" \
  -d '{"system": "You are a pirate. Respond in pirate speak."}'
```

Reset to default:

```bash
curl -X PATCH http://localhost:4000/api/agents/general \
  -H "X-API-Key: test" \
  -H "Content-Type: application/json" \
  -d '{"reset": true}'
```

## Configuration

Environment variables are validated with `t3-env` at startup. The server will exit with a clear error if required values are missing.

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENROUTER_API_KEY` | Yes | -- | API key from [openrouter.ai/keys](https://openrouter.ai/keys) |
| `DEFAULT_MODEL` | No | `openai/gpt-4o-mini` | Default LLM model for all agents |
| `API_KEY` | No | `test` | API key clients must send in the `X-API-Key` header |
| `PORT` | No | `4000` | Server listen port |
| `OPENAI_API_KEY` | No | -- | Enables OpenAI voice provider (TTS/STT) |
| `GROQ_API_KEY` | No | -- | Enables Groq voice provider (STT via Whisper) |
| `VOICE_PROVIDER` | No | `openai` | Default voice provider name |
| `VOICE_TTS_MODEL` | No | `tts-1` | Text-to-speech model |
| `VOICE_STT_MODEL` | No | `gpt-4o-mini-transcribe` | Speech-to-text model |
| `VOICE_DEFAULT_SPEAKER` | No | `alloy` | Default TTS voice |
| `VOICE_RETAIN_AUDIO` | No | `false` | Keep generated audio files in `data/audio/` |
| `BRAVE_API_KEY` | No | -- | Brave Search API key (for additional tools) |
| `TMDB_API_KEY` | No | -- | TMDB API key (for additional tools) |

## Data Directory

The `data/` directory is used by `createFileStorage` to persist state across server restarts:

```
data/
  conversations/   # Saved conversation histories (JSON files)
  memory/          # Agent memory namespaces
  audio/           # Retained voice audio files (when VOICE_RETAIN_AUDIO=true)
  skills/          # Skill definitions that agents can activate
    concise/       # "Respond concisely" -- keeps answers under 3 sentences
    formal-tone/   # "Use formal language" -- avoids contractions and slang
    step-by-step/  # "Break down answers into steps" -- numbered step format
  prompt-overrides.json  # Persisted system prompt overrides set via PATCH
```

Each skill is a directory containing a `README.md` with YAML front matter (`description`, `phase`) and markdown instructions. Skills modify agent behavior when activated for a conversation.

## Further Reading

See the [main kitn README](../../README.md) for full documentation on the `@kitn/routes` package, client SDK, and architecture overview.
