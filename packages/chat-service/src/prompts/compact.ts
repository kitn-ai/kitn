export function buildCompactionPrompt(): string {
  return `You are compacting a conversation history for the kitn assistant.

Produce a concise summary that preserves ALL of the following:
- Decisions already made (chosen APIs, storage backends, component names, component types)
- File paths created, modified, or referenced
- Environment variable names that were configured (but NEVER include actual API key values, passwords, or secrets)
- Current plan status (what steps are done, what's pending)
- Component names and their relationships (links, dependencies between tools and agents)
- Error messages or warnings that were encountered and are still relevant
- User preferences or constraints expressed during the conversation

Explicitly EXCLUDE:
- Actual secret values (API key values, passwords, tokens) — these must never appear
- Verbose tool call details that are no longer relevant
- Exploratory questions that were already fully resolved
- Intermediate reasoning that led to final decisions (only keep the decisions)

Format as a natural paragraph summary that another AI can use to continue the conversation seamlessly.
Start with "Previous conversation summary:" and write in past tense.`;
}
