---
title: Structured event protocol for extension widgets
type: breaking
authors:
  - mavam
  - codex
created: 2026-07-23T17:56:33.955956Z
---

Extension widgets now use structured snapshots over pi's in-process event bus,
so producers can provide text, icon glyphs and colors, and layout defaults
without depending on `pi-fancy-footer`.

The callback-based helpers have been removed. Producers should emit complete
protocol-1 `upsert` messages on `pi-fancy-footer:widget`, republish when
`pi-fancy-footer:ready` fires, and emit `remove` during shutdown:

```ts
pi.events.emit("pi-fancy-footer:widget", {
  protocol: 1,
  type: "upsert",
  widget: {
    id: "acme.status",
    content: { type: "text", text: "passing" },
    layout: { enabled: false },
  },
});
```

Saved user settings continue to override the defaults carried by the event.
