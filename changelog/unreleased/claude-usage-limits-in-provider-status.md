---
title: Claude usage limits in provider status
type: feature
authors:
  - mavam
  - codex
created: 2026-06-16T10:35:51.026328Z
---

The `provider-status` widget can now show Claude usage limits alongside Codex quotas.

Enable the Anthropic provider adapter with:

```json
{
  "providerStatus": {
    "providers": ["openai-codex", "anthropic"]
  }
}
```

Claude-backed models display the current 5-hour session window and weekly usage window, matching the usage information shown in Claude.ai settings.
