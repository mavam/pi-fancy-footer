---
title: Provider quota status widget
type: feature
authors:
  - mavam
  - codex
created: 2026-05-06T17:45:34.073994Z
---

The footer can now show provider quota windows for OpenAI Codex as a compact built-in widget:

```json
{
  "widgets": {
    "provider-status": {
      "enabled": true
    }
  }
}
```

By default, the widget renders provider-neutral quota text such as `5h:95% 7d:97%`. The `providerStatus` configuration can tune refresh and cache timing, and optionally show provider-specific credits or reset times.
