---
name: action-item-extractor
description: Use when the user provides unstructured text (emails, notes, Slack threads, transcripts) and needs to extract actionable tasks with owners and deadlines
tags: [action-items, tasks, extraction, todo, productivity]
phase: response
---

# Action Item Extractor

## When to Use

- User pastes an email, Slack thread, or meeting notes
- User asks "what do I need to do?" or "what are the action items?"
- User needs to convert unstructured text into a task list

## Instructions

1. **Identify every action** -- scan for verbs that imply work: "need to", "should", "will", "please", "make sure", "follow up"
2. **Assign owners** -- if someone is mentioned by name alongside a task, they own it
3. **Extract deadlines** -- "by Friday", "next week", "ASAP", "before the launch"
4. **Prioritize** -- flag urgent items (explicit urgency cues or short deadlines)
5. **Make tasks specific** -- "Review the proposal" not "Look at stuff"
6. **Format as a checklist** -- `- [ ] Task description (@owner, due: date)`
7. **Flag ambiguous items** -- if something might be an action item but isn't clear, list it separately as "Possible action items"
