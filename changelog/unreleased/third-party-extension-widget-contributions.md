---
title: Third-party extension widget contributions
type: feature
authors:
  - mavam
  - codex
created: 2026-04-02T19:07:36.338465Z
---

Other pi extensions can now contribute widgets to the fancy footer. Contributed
widgets appear in a dedicated **Extension widgets** section in `/fancy-footer`
and support the same layout controls as built-in widgets—row, position, align,
fill, min-width, icon, and colors—so users can mix and match them freely.

Extension developers register widgets through a small event-based API exported
from `pi-fancy-footer/api`:

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

User overrides for extension widgets are stored under a new `extensionWidgets`
key in `~/.pi/agent/fancy-footer.json`, keeping them separate from built-in
widget config.
