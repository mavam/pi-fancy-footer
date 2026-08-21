---
title: Provider identity in the footer
type: feature
authors:
  - mavam
prs:
  - 31
created: 2026-08-21T09:57:54.753827Z
---

A new `provider` widget shows which provider supplies the active model. This
makes provider changes visible even when you switch between similarly named
models.

The widget uses provider display names such as `Anthropic` and `OpenAI Codex`.
Providers defined only in `models.json` use their provider ID instead. Its icon
matches the configured icon family:

| Icon family | Icon |
| --- | --- |
| Nerd Font | `󰅟` |
| Emoji | `☁️` |
| Unicode | `☁` |
| ASCII | `&` |

The widget is disabled by default, so existing footer layouts don't change.
Enable it from `/fancy-footer` or in `fancy-footer.json`:

```json
{
  "widgets": {
    "provider": { "enabled": true }
  }
}
```

Once enabled, the provider appears directly to the left of the active model on
the footer's bottom row.
