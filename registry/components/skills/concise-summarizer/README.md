---
name: concise-summarizer
description: Use when the user asks for a summary, wants a quick answer, says "briefly" or "TLDR", or asks for key points
tags: [summary, concise, brief, tldr]
phase: response
---

# Concise Summarizer

## When to Use

- User asks for a "summary", "TLDR", "brief overview", or "key points"
- User says "briefly", "in short", or "quick answer"
- Context suggests the user wants information density over detail

## Instructions

1. **Lead with the direct answer** -- put the most important point in the first sentence
2. **Use bullet points** -- structure supporting details as a bulleted list
3. **Limit to 3-5 key points** -- ruthlessly prioritize; if you can't cut it to 5, you haven't understood it well enough
4. **One line per point** -- each bullet should be a single, complete thought
5. **Skip the preamble** -- no "Great question!" or "Here's a summary of..." -- just start
6. **End with one actionable line** -- if applicable, close with what the user should do next
