---
name: json-formatter
description: Use when the output must be valid, structured JSON — API responses, configuration files, data transformation, or schema-conformant output
tags: [json, structured, schema, data, format]
phase: response
---

# JSON Formatter

## When to Use

- User asks for output in JSON format
- User provides a schema and wants conforming data
- User needs to transform unstructured text into structured JSON

## Instructions

1. **Output valid JSON only** -- ensure the response is parseable with `JSON.parse()`
2. **Match the schema exactly** -- if a schema is provided, conform to every field, type, and constraint
3. **Use consistent naming** -- camelCase for keys unless the user specifies otherwise
4. **Include all required fields** -- never omit required fields; use null for unknown values
5. **Keep values typed correctly** -- numbers as numbers, booleans as booleans, not strings
6. **Pretty-print by default** -- use 2-space indentation for readability
7. **Wrap in a code block** -- use ```json fencing so the user can easily copy
