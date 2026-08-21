This release adds an optional provider widget that identifies the provider behind the active model. It also updates the model and thinking indicators immediately when you change them.

## 🚀 Features

### Provider identity in the footer

A new `provider` widget shows which provider supplies the active model. This makes provider changes visible even when you switch between similarly named models.

The widget uses provider display names such as `Anthropic` and `OpenAI Codex`. Providers defined only in `models.json` use their provider ID instead. Its icon matches the configured icon family:

| Icon family | Icon |
| ----------- | ---- |
| Nerd Font   | `󰅟`  |
| Emoji       | `☁️` |
| Unicode     | `☁`  |
| ASCII       | `&`  |

The widget is disabled by default, so existing footer layouts don't change. Enable it from `/fancy-footer` or in `fancy-footer.json`:

```json
{
  "widgets": {
    "provider": { "enabled": true }
  }
}
```

Once enabled, the provider appears directly to the left of the active model on the footer's bottom row.

*By @mavam in #31.*

## 🐞 Bug fixes

### Immediate model and thinking updates

Model and thinking-level changes now appear in the footer immediately. They no longer wait for the next background Git refresh, which could delay updates by several seconds.

*By @mavam in #32.*
