---
title: Provider widget
type: feature
authors:
  - mavam
---

A new `provider` widget shows the provider behind the active model, so switching
between models from different providers is visible in the footer instead of only
changing the model name. It uses the provider's display name (`Anthropic`,
`OpenAI Codex`, …) and falls back to the provider id for providers defined only
in `models.json`. The widget is hidden by default; enable it via
`/fancy-footer` or with `"provider": { "enabled": true }`.
