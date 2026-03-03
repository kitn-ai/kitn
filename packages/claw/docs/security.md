# KitnClaw Security

## Philosophy

KitnClaw is designed for people who want a capable AI assistant without needing to be security experts. Safety controls are layered into three levels of complexity:

1. **Safety profiles** (simple) -- Pick cautious, balanced, or autonomous during setup. No config files required.
2. **Governance policies** (moderate) -- Control specific action types: auto-execute, hold for review, or block entirely.
3. **Firewall rules** (advanced) -- Per-tool argument patterns and path restrictions for power users.

A critical design principle: **the AI cannot override safety controls**. Permission checks, budget limits, rate limits, and governance policies are all enforced at the tool execution layer, before any action is taken. The AI model never sees or can manipulate these checks -- they are hardcoded into the tool wrappers.

## Safety Profiles

Every tool invocation is classified into one of 13 action types. The active safety profile determines whether each action type is executed automatically or requires user confirmation.

| Action Type | Cautious | Balanced | Autonomous |
|---|---|---|---|
| `read-file` | Confirm | Allow | Allow |
| `write-file-sandbox` | Confirm | Allow | Allow |
| `write-file-granted` | Confirm | Allow | Allow |
| `write-file-other` | Confirm | Confirm | Allow |
| `web-search` | Confirm | Allow | Allow |
| `web-fetch` | Confirm | Allow | Allow |
| `memory` | Allow | Allow | Allow |
| `shell-command` | Confirm | Confirm | Allow |
| `delete` | **Confirm** | **Confirm** | **Confirm** |
| `send-message` | **Confirm** | **Confirm** | **Confirm** |
| `install-component` | Confirm | Confirm | Allow |
| `create-tool` | Confirm | Confirm | Allow |
| `unknown` | Confirm | Confirm | Confirm |

**ALWAYS_ASK actions:** `delete` and `send-message` always require confirmation, regardless of which profile is active. These are hardcoded and cannot be overridden by configuration. Even in autonomous mode, KitnClaw will ask before deleting a file or sending a message on your behalf.

### How classification works

When a tool is invoked, the permission manager classifies it based on the tool name and its input arguments. For file writes, the path determines the sub-category:

- **write-file-sandbox** -- The file is inside `~/.kitnclaw/workspace/` (always accessible)
- **write-file-granted** -- The file is inside a directory you have explicitly granted access to
- **write-file-other** -- The file is anywhere else

This classification happens before the profile lookup, so the profile table above reflects the actual behavior for each scenario.

## Directory Sandbox

KitnClaw restricts filesystem access by default:

- **Workspace** (`~/.kitnclaw/workspace/`) -- Always accessible for reads and writes. This is where KitnClaw stores its own tools, agents, and user-created content.
- **Granted directories** -- Directories you explicitly allow via `permissions.grantedDirs` in config or via the setup wizard. Example: `["/home/user/Documents", "/home/user/Projects"]`.
- **Everything else** -- Requires per-request permission (in cautious/balanced mode) or is allowed automatically (in autonomous mode, except deletes).

### Path traversal prevention

Directory matching uses prefix comparison with trailing-slash normalization. A configured directory of `/home/user/Documents` is normalized to `/home/user/Documents/` before comparison. This prevents a path like `/home/user/Documents-secret/file.txt` from matching the grant for `/home/user/Documents`.

### Runtime grants

During a session, when KitnClaw asks for permission to access a file outside the sandbox, you can choose "Grant directory" to add that file's parent directory to the allowed list for the remainder of the gateway session. Runtime grants reset when the gateway restarts.

## Per-Action Governance

Governance policies give you control over specific categories of actions, independent of safety profiles. Each action category can be set to one of three modes:

| Mode | Behavior |
|---|---|
| `auto` | Execute immediately, no review |
| `draft` | Execute but hold the result for review before delivery |
| `blocked` | Deny entirely -- the tool call is rejected |

### Default governance

By default, three action categories are set to `draft`:

```json
{
  "governance": {
    "actions": {
      "send-message": "draft",
      "post-public": "draft",
      "schedule": "draft"
    }
  }
}
```

### Tool-to-action mapping

Multiple tools can map to the same governance action category:

| Tool Name | Action Category |
|---|---|
| `send-message` | `send-message` |
| `send-email` | `send-message` |
| `post-tweet` | `post-public` |
| `post-social` | `post-public` |
| `schedule-job` | `schedule` |
| `create-cron` | `schedule` |

You can also target tools directly by name in the governance config. If a tool name does not map to a known category, the system checks for a direct match against the tool name.

### Evaluation order

When a tool is invoked, the permission system evaluates in this order:

1. **Denied list** -- Is the tool globally denied? Deny.
2. **Channel overrides** -- Is the tool denied for this channel? Deny.
3. **Firewall rules** -- Does a per-tool rule apply? Allow or deny.
4. **Governance** -- Is the action auto/draft/blocked? Apply.
5. **Safety profile** -- Classify the action and check the profile matrix.
6. **Rate limiter** -- Has the tool exceeded its rate limit? Deny.
7. **Session trust** -- Has the user trusted this tool for the session? Allow.

## Budget Enforcement

Budget enforcement prevents runaway spending on external APIs or services. It uses a libSQL-backed ledger (`BudgetLedger`) stored in `~/.kitnclaw/claw.db`.

### How it works

Before a tool that incurs cost can execute, it calls `trySpend(domain, amount)`:

1. Look up the budget for the given domain (e.g., `"api-calls"`, `"purchases"`)
2. If no budget exists for the domain and no `"default"` budget is configured, spending is **denied**
3. Sum all spending in the current period (daily, weekly, or monthly)
4. If the new amount would exceed the limit, the transaction is **rejected** -- the entry is not recorded
5. If within budget, the entry is recorded and the action proceeds

This is a hard block. The AI model has no way to bypass it -- the check happens in the tool's execute function before the action is taken.

### Configuration

```json
{
  "governance": {
    "budgets": {
      "api-calls": { "limit": 50, "period": "monthly" },
      "purchases": { "limit": 100, "period": "monthly" },
      "default": { "limit": 10, "period": "daily" }
    }
  }
}
```

Each domain has:
- `limit` -- Maximum spend in the period (numeric, e.g., dollars)
- `period` -- `"daily"`, `"weekly"`, or `"monthly"`

The special `"default"` key applies to any domain not explicitly listed. If neither the specific domain nor a default budget exists, the spend is denied.

## Draft Queue

When a governance policy sets an action to `draft` mode, the tool executes but its result is held for review before being delivered. The draft queue is libSQL-backed for durability (stored in `~/.kitnclaw/claw.db`).

### Workflow

1. Tool executes and produces a result
2. A draft entry is created with status `pending`, containing:
   - Action category
   - Tool name
   - Input arguments
   - Human-readable preview
   - Session ID
3. The user is notified that an action is pending review
4. The user reviews the draft via the TUI or web UI
5. **Approve** -- the result is delivered to the conversation
6. **Reject** -- the result is discarded

Draft entries include timestamps and are stored persistently, so pending items survive gateway restarts.

## Rate Limiting

Rate limiting prevents runaway tool calls within a time window. It uses a per-tool sliding window counter.

### Configuration

```json
{
  "permissions": {
    "rateLimits": {
      "maxPerMinute": 30,
      "toolLimits": {
        "bash": 10,
        "web-fetch": 20
      }
    }
  }
}
```

- `maxPerMinute` -- Global default limit for all tools
- `toolLimits` -- Optional per-tool overrides (tool name to max-per-minute)

When a tool exceeds its rate limit, the call is denied. The window resets automatically after the configured period (default: 60 seconds).

Rate limiting is only applied to tools that would otherwise be auto-allowed by the safety profile. Tools that already require confirmation are not rate-limited (the confirmation prompt itself is the throttle).

## Audit Logging

Every tool execution is logged to `~/.kitnclaw/claw.db` (libSQL) in the `audit_log` table. This provides a full history of what your assistant did and why.

### Schema

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Auto-incrementing primary key |
| `event` | TEXT | Event type (e.g., `tool:execute`) |
| `tool_name` | TEXT | Name of the tool that was called |
| `input` | TEXT | JSON-encoded input arguments |
| `decision` | TEXT | Permission decision (`allow`, `confirm`, `deny`, `draft`) |
| `reason` | TEXT | Why the decision was made |
| `session_id` | TEXT | Conversation session identifier |
| `channel_type` | TEXT | Channel the request came from (`terminal`, `http`, `websocket`) |
| `duration` | REAL | Execution time in milliseconds |
| `metadata` | TEXT | JSON-encoded additional data |
| `created_at` | TEXT | ISO 8601 timestamp |

### Querying

The audit log is a standard SQLite database. You can query it directly:

```bash
# Recent tool calls
sqlite3 ~/.kitnclaw/claw.db "SELECT created_at, tool_name, decision FROM audit_log ORDER BY created_at DESC LIMIT 20"

# All denied actions
sqlite3 ~/.kitnclaw/claw.db "SELECT created_at, tool_name, reason FROM audit_log WHERE decision = 'deny'"

# Tool usage by session
sqlite3 ~/.kitnclaw/claw.db "SELECT tool_name, COUNT(*) as calls FROM audit_log WHERE session_id = 'abc123' GROUP BY tool_name"
```

Audit logging is wired into the gateway's lifecycle hooks and runs automatically. There is no way to disable it.

## Credential Storage

API keys and secrets are never stored in plain text in the config file.

### Storage layers

1. **OS keychain** (preferred) -- KitnClaw uses [keytar](https://github.com/nicolo-ribaudo/keytar) to store credentials in the operating system's native keychain (macOS Keychain, Windows Credential Vault, Linux Secret Service). All credentials are stored under the service name `kitnclaw`.

2. **File fallback** -- If the keytar native module is not available (e.g., headless servers, containers), credentials are stored as base64-encoded files in `~/.kitnclaw/credentials/` with `0600` permissions. This is not encryption, but prevents casual reading of plain text values.

### How it works

When you run `kitnclaw setup` and enter an API key:
1. The key is stored in the OS keychain (if available) under the key `<provider>-api-key`
2. If keychain is unavailable, the key is base64-encoded and written to `~/.kitnclaw/credentials/<provider>-api-key`
3. The credentials directory is set to `0700` permissions

The `CredentialStore` class attempts keytar first and falls back to file storage transparently. You can also store credentials programmatically via the store's `set(key, value)` method.

## Multi-User Access

KitnClaw supports three user roles with different permission levels:

| Capability | Operator | User | Guest |
|---|---|---|---|
| All tools | Yes | Yes | Restricted |
| `bash` | Yes | Yes | Denied |
| `file-write` | Yes | Yes | Denied |
| `file-delete` | Yes | Yes | Denied |
| `create-tool` | Yes | Yes | Denied |
| `create-agent` | Yes | Yes | Denied |
| Channel access | All | Configurable | Configurable |
| Custom denials | No | Optional | Optional |

### Configuration

```json
{
  "users": {
    "alice": { "role": "operator" },
    "bob": {
      "role": "user",
      "channels": ["terminal", "http"],
      "denied": ["bash"]
    },
    "web-visitor": {
      "role": "guest",
      "channels": ["http"]
    }
  }
}
```

- **operator** -- Full access to all tools and channels
- **user** -- Standard access. You can restrict channels and deny specific tools.
- **guest** -- Restricted by default: `bash`, `file-write`, `file-delete`, `create-tool`, and `create-agent` are all denied. Additional denials can be added.

Unknown users (not listed in config) default to the `guest` role.

### Channel access

Each user can be restricted to specific channels via the `channels` array. If omitted or empty, the user can access all channels. Operators always have access to all channels regardless of this setting.

### Pairing codes

For messaging channels (Discord, Telegram, WhatsApp), users authenticate via pairing codes:

1. The operator generates a 6-character alphanumeric code for a user + channel combination
2. The code is valid for 5 minutes (single-use)
3. The user sends the code to the bot in the messaging app
4. On successful validation, the messaging account is linked to the KitnClaw user

Codes use a reduced character set (no O/0/I/1) for readability.

## Progressive Trust

When KitnClaw asks for permission, you have options beyond simple allow/deny:

- **Allow** -- Permit this specific tool call
- **Deny** -- Reject this specific tool call
- **Trust for session** -- Auto-allow this tool for the remainder of the current gateway session. Useful when you know you will need many file reads in a row.
- **Grant directory** -- Add the target file's directory to the allowed list for the session. Useful when working in a project directory.

All progressive trust decisions reset when the gateway restarts. They are not persisted to config. This ensures a clean slate on every launch.

## Advanced Firewall Rules

For power users who want fine-grained control over specific tools, firewall rules allow pattern-based filtering of tool arguments.

### Configuration

```json
{
  "permissions": {
    "rules": {
      "bash": {
        "denyPatterns": ["rm\\s+-rf", "sudo\\s+"],
        "allowPatterns": ["^ls\\b", "^cat\\b", "^grep\\b"],
        "denyPaths": ["/etc/", "/usr/"],
        "allowPaths": ["/home/user/projects/"]
      },
      "file-write": {
        "denyPaths": ["/etc/", "/usr/local/bin/"],
        "allowPaths": ["/home/user/Documents/"]
      }
    }
  }
}
```

### Rule types

| Field | Applies to | Behavior |
|---|---|---|
| `denyPatterns` | `input.command` | Regex patterns. If any matches, the call is **denied**. |
| `denyPaths` | `input.path` | Path prefixes. If the path starts with any, the call is **denied**. |
| `allowPatterns` | `input.command` | Regex patterns. If any matches, the call is **allowed**. |
| `allowPaths` | `input.path` | Path prefixes. If the path starts with any, the call is **allowed**. |

### Evaluation logic

1. **Deny checks first** -- If the command matches any `denyPatterns` or the path matches any `denyPaths`, the call is denied.
2. **Allow checks second** -- If any allow constraint is defined (`allowPatterns` or `allowPaths`), the input must match at least one. If nothing matches, the call is denied (allowlist mode).
3. **No constraints** -- If no rule exists for the tool, fall through to governance and profile checks.

### Safety notes

- Invalid regex patterns in `denyPatterns` or `allowPatterns` are silently caught and skipped. A malformed pattern will not crash the system or accidentally allow dangerous commands.
- Deny rules always take priority over allow rules. You cannot allowlist something that is explicitly denied.
- Firewall rules are evaluated before governance policies and safety profiles in the permission chain.
