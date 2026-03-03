/**
 * Rules template section extraction for the MCP help tool.
 *
 * Parses ## sections from the rules template and provides keyword-based
 * search to find sections relevant to a given topic.
 */

export interface RulesSection {
  title: string;
  keywords: string[];
  content: string;
}

/**
 * Keyword mapping: section title substrings -> keywords that match.
 *
 * When a section title contains one of the keys (case-insensitive),
 * the corresponding keywords are assigned to that section.
 */
const KEYWORD_MAP: Array<{ titleMatch: string; keywords: string[] }> = [
  { titleMatch: "project structure", keywords: ["init", "getting started", "setup", "structure", "project"] },
  { titleMatch: "tool", keywords: ["tool", "defining tools", "inputschema", "directexecute"] },
  { titleMatch: "agent", keywords: ["agent", "defining agents", "system prompt", "registration"] },
  { titleMatch: "skill", keywords: ["skill", "skills", "frontmatter", "markdown"] },
  { titleMatch: "cron", keywords: ["cron", "scheduling", "schedule"] },
  { titleMatch: "wiring", keywords: ["tool", "agent", "wiring", "link"] },
  { titleMatch: "self-registration", keywords: ["registration", "barrel", "import", "side-effect"] },
  { titleMatch: "import convention", keywords: ["import", "conventions", "ai sdk", "v6"] },
  { titleMatch: "cli", keywords: ["cli", "command", "commands", "init", "add", "remove", "create", "link", "unlink", "list", "diff", "update", "rules"] },
  { titleMatch: "common tasks", keywords: ["create", "scaffold", "wire", "install", "browse", "add"] },
  { titleMatch: "orchestrator", keywords: ["orchestrator", "multi-agent", "delegation", "routing"] },
  { titleMatch: "storage", keywords: ["storage", "database", "sub-store", "provider"] },
  { titleMatch: "voice", keywords: ["voice", "createvoice", "audio", "tts"] },
  { titleMatch: "job", keywords: ["jobs", "background", "async", "sse", "reconnect"] },
  { titleMatch: "memory", keywords: ["memory", "namespace", "context injection"] },
  { titleMatch: "hook", keywords: ["hooks", "lifecycle", "summary", "trace"] },
  { titleMatch: "lifecycle", keywords: ["hooks", "lifecycle", "summary", "trace"] },
  { titleMatch: "mcp", keywords: ["mcp", "model context protocol"] },
  { titleMatch: "guard", keywords: ["guard", "approval", "moderation"] },
  { titleMatch: "command", keywords: ["commands", "runtime", "api"] },
  { titleMatch: "api", keywords: ["api", "endpoints", "routes"] },
  { titleMatch: "component", keywords: ["component", "agent", "tool", "skill", "cron", "pattern"] },
];

/**
 * Parse a rules template into sections split on `## ` headers.
 *
 * The first section (before any `## ` header) is included with the title
 * set to the `# ` header text (if present) or "Introduction".
 */
export function parseRulesSections(template: string): RulesSection[] {
  const sections: RulesSection[] = [];
  const lines = template.split("\n");

  let currentTitle = "";
  let currentLines: string[] = [];
  let foundFirstH2 = false;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      // Save previous section
      if (currentLines.length > 0 || foundFirstH2) {
        const content = currentLines.join("\n").trim();
        if (content.length > 0) {
          const title = currentTitle || "Introduction";
          sections.push({
            title,
            keywords: deriveKeywords(title),
            content,
          });
        }
      }

      // Start new section
      currentTitle = line.slice(3).trim();
      currentLines = [line];
      foundFirstH2 = true;
    } else if (!foundFirstH2 && line.startsWith("# ") && !currentTitle) {
      // Capture top-level H1 title for the introduction section
      currentTitle = line.slice(2).trim();
      currentLines.push(line);
    } else {
      currentLines.push(line);
    }
  }

  // Save last section
  if (currentLines.length > 0) {
    const content = currentLines.join("\n").trim();
    if (content.length > 0) {
      const title = currentTitle || "Introduction";
      sections.push({
        title,
        keywords: deriveKeywords(title),
        content,
      });
    }
  }

  return sections;
}

/**
 * Derive keywords for a section based on its title.
 *
 * Matches the title against the KEYWORD_MAP entries. If no keyword map
 * entry matches, falls back to splitting the title into lowercase words.
 */
function deriveKeywords(title: string): string[] {
  const lowerTitle = title.toLowerCase();
  const matched = new Set<string>();

  for (const entry of KEYWORD_MAP) {
    if (lowerTitle.includes(entry.titleMatch)) {
      for (const kw of entry.keywords) {
        matched.add(kw);
      }
    }
  }

  if (matched.size === 0) {
    // Fallback: use title words as keywords (strip punctuation)
    const words = lowerTitle
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2);
    for (const word of words) {
      matched.add(word);
    }
  }

  return Array.from(matched);
}

/**
 * Find sections relevant to a given topic string.
 *
 * 1. Checks if any section keywords appear in the lowercased topic.
 * 2. If no keyword match, falls back to fuzzy matching against section titles.
 * 3. Returns all matching sections (could be multiple).
 */
export function findRelevantSections(
  sections: RulesSection[],
  topic: string,
): RulesSection[] {
  const lowerTopic = topic.toLowerCase();

  // Phase 1: keyword matching
  const keywordMatches = sections.filter((section) =>
    section.keywords.some((kw) => lowerTopic.includes(kw)),
  );

  if (keywordMatches.length > 0) {
    return keywordMatches;
  }

  // Phase 2: fuzzy title matching — check if any word from the topic
  // appears in the section title, or vice versa
  const topicWords = lowerTopic
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const fuzzyMatches = sections.filter((section) => {
    const lowerSectionTitle = section.title.toLowerCase();
    return topicWords.some(
      (word) =>
        lowerSectionTitle.includes(word) || word.includes(lowerSectionTitle),
    );
  });

  return fuzzyMatches;
}
