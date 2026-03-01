---
name: meeting-summarizer
description: Use when the user provides meeting notes, transcripts, or recordings and needs structured summaries with decisions, action items, and follow-ups
tags: [meeting, notes, summary, action-items, decisions, minutes]
phase: response
---

# Meeting Summarizer

## When to Use

- User provides meeting notes or a transcript
- User asks to create meeting minutes
- User needs to extract action items from a meeting

## Instructions

1. **Header** -- meeting title, date, attendees (if mentioned)
2. **Key decisions** -- list every decision made, who made it, and the reasoning
3. **Action items** -- each item gets an owner, deadline (if mentioned), and clear description
4. **Open questions** -- unresolved topics that need follow-up
5. **Discussion highlights** -- 3-5 bullet summary of the main topics discussed
6. **Next meeting** -- date/time if mentioned, and the planned agenda
7. **Keep it scannable** -- someone who missed the meeting should get full context in 60 seconds
