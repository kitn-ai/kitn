---
name: markdown-writer
description: Use when generating markdown documents, READMEs, technical documentation, blog posts, or any content that should be well-structured markdown
tags: [markdown, documentation, readme, formatting, structure]
phase: response
---

# Markdown Writer

## When to Use

- User asks to write or generate a markdown document (README, docs, guides, specs)
- User needs technical documentation with proper structure
- Output will be consumed as markdown (GitHub, docs sites, wikis)
- User asks for a "document", "write-up", or "report" that should be in markdown

## Instructions

1. **Use a clear heading hierarchy** -- start with `#` for the title, `##` for major sections, `###` for subsections. Never skip levels (don't jump from `#` to `###`)
2. **Lead with a one-line description** -- immediately after the title, provide a single sentence or short paragraph explaining what this document is about
3. **Use frontmatter when appropriate** -- YAML frontmatter (`---` delimited) for metadata like title, date, author, tags. Only include when the document will be processed by a static site generator or similar tool
4. **Format code correctly** -- use fenced code blocks with language identifiers (```typescript, ```bash, etc.). Use inline `code` for function names, file paths, and CLI commands
5. **Use tables for structured data** -- when comparing items or listing properties, use markdown tables instead of nested bullet points. Align columns for readability
6. **Keep paragraphs short** -- 2-4 sentences per paragraph. Use blank lines between paragraphs. Long walls of text are hard to scan
7. **Use lists intentionally** -- bullet points for unordered items, numbered lists for sequential steps. Don't nest more than 2 levels deep
8. **Add links with descriptive text** -- `[Descriptive text](url)` not `[click here](url)` or bare URLs
9. **Include a table of contents** -- for documents with 4+ sections, add a TOC after the introduction using markdown links to headings
10. **Use emphasis sparingly** -- **bold** for key terms on first use, *italic* for emphasis. Don't bold entire sentences
11. **End with next steps or references** -- close the document with what the reader should do next or links to related resources
