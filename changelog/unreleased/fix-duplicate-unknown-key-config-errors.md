---
title: Fix duplicate unknown-key config errors
type: bugfix
authors:
  - mavam
created: 2026-09-30T10:53:24.095427Z
---

Config validation with current TypeBox releases no longer prints a duplicate "schema is false" line for each unknown key.
