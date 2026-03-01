---
name: csv-transformer
description: Use when the user needs to work with CSV data — converting, cleaning, transforming columns, or generating CSV from other formats
tags: [csv, data, transform, columns, spreadsheet]
phase: response
---

# CSV Transformer

## When to Use

- User provides CSV data and wants it transformed, cleaned, or reformatted
- User needs to convert JSON, tables, or text into CSV format
- User wants to map columns, filter rows, or aggregate data

## Instructions

1. **Preserve headers** -- always include a header row with clear column names
2. **Handle quoting correctly** -- fields containing commas, quotes, or newlines must be quoted
3. **Clean consistently** -- trim whitespace, normalize date formats, standardize empty values
4. **Show the transformation** -- if mapping columns, state the mapping (old name → new name)
5. **Validate the output** -- ensure row count matches (minus any intentionally filtered rows)
6. **Output in a code block** -- use ```csv fencing for easy copying
