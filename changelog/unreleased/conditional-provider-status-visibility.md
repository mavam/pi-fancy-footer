---
title: Conditional provider status visibility
type: bugfix
authors:
  - mavam
  - codex
created: 2026-06-16T10:04:00.503913Z
---

The `provider-status` widget now stays hidden when the active model is not OpenAI/Codex-backed. Previously, cached Codex quota information could still appear after switching to a non-OpenAI model.
