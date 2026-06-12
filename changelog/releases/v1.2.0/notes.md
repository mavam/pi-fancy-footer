The footer now presents context usage and provider quota windows as compact gauges, making resource pressure easier to scan at a glance. This release also simplifies gauge configuration, removes the separate context usage widget, and improves validation errors for renamed or mistyped settings.

## 🚀 Features

### Provider quota status widget

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

*By @mavam and @codex.*

## 🔧 Changes

### Context window mini gauge

The `context-bar` widget now renders the same mini gauge as the provider status widget instead of growing to fill its footer row: it fills from the left as the context window is consumed, colored by how close the window is to exhaustion, followed by the used percentage, e.g. `■■□□□ 45%`. The top row now defaults to the context and provider quota gauges on the left, with the context capacity and session cost on the right.

This is a hard cut with config-level breaking changes:

- The `contextBarStyle` setting is now `gaugeStyle` and themes both the context and provider status gauges. Styles are binary—each defines a filled and an empty glyph; the third "reserved" glyph and the compaction reserve tail are gone.
- The new `gaugeWidth` setting (3-40 cells, default 5) controls how many cells all gauges span.
- The new `gaugeColors` setting maps gauge severity to widget colors (`ok` / `warning` / `error`). Healthy gauges now default to the theme accent instead of green, so they blend into the theme and only stand out when a resource runs low.
- The `context-usage` widget (used tokens as `Nk`) is gone; the context gauge conveys the same information.
- The provider status widget no longer wraps its output in an OSC 8 hyperlink, which some terminals render with a distracting underline.

To smooth the migration, config validation errors now name the offending keys instead of reporting a bare "must not have additional properties": renamed keys point at their replacement (`unknown key "contextBarStyle" (it was renamed to "gaugeStyle")`) and typos get a closest-match suggestion (`unknown key "guageWidth" (did you mean "gaugeWidth"?)`). The footer falls back to defaults and tells you to run `/fancy-footer` until the config is fixed.

*By @mavam and @claude.*
