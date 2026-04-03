This release adds third-party widget contributions and clearer widget summaries, making the fancy footer easier to extend and configure.

## 🚀 Features

### Third-party extension widget contributions

Other pi extensions can now contribute widgets to the fancy footer. Contributed widgets appear in a dedicated **Extension widgets** section in `/fancy-footer` and support the same layout controls as built-in widgets—row, position, align, fill, min-width, icon, and colors—so users can mix and match them freely.

Extension developers register widgets through a small event-based API exported from `pi-fancy-footer/api`:

```ts
import { contributeFancyFooterWidgets } from "pi-fancy-footer/api";

export default function (pi) {
  contributeFancyFooterWidgets(pi, {
    id: "acme.build-status",
    description: "Shows the latest CI result.",
    defaults: { row: 1, position: 8, align: "right", fill: "none" },
    icon: { nerd: "󰙨", emoji: "🧪", unicode: "◈", ascii: "B" },
    renderText: () => "passing",
  });
}
```

User overrides for extension widgets are stored under a new `extensionWidgets` key in `~/.pi/agent/fancy-footer.json`, keeping them separate from built-in widget config.

*By @mavam and @codex.*

## 🔧 Changes

### Clearer widget summaries in the settings screen

The widget summary in the `/fancy-footer` settings screen now shows only what you actually changed, instead of echoing every property including defaults. Labels are also more readable:

Before:

```
󰾆 context-bar       r0 p0 middle icon:off
```

After:

```
󰾆 context-bar       icon:hidden
```

Properties that match the widget's built-in defaults are omitted. If nothing is customized, the summary reads `default`. Renamed labels use clearer names like `row:`, `pos:`, `align:`, `icon:hidden`, and `width:` instead of the old `r`/`p`/`w:` shorthand.

*By @mavam and @claude.*
