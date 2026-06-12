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

By default, the widget renders each quota window as a battery-style mini gauge such as `5h ▰▰▰▰▱ 80% 7d ▰▰▱▱▱ 38%`, reusing the configured context bar glyphs and coloring each window by how close it is to exhaustion. Set `providerStatus.display` to `text` for the compact `5h:95% 7d:97%` form. The `providerStatus` configuration can also tune refresh and cache timing, choose providers, and optionally show provider-specific credits or reset times.

Internally, providers plug in through a status source abstraction, so future providers beyond OpenAI Codex can contribute quota windows through the same widget.
