Pi Fancy Footer now accepts validated, styled widget snapshots over Pi's event bus, allowing extensions to integrate without a package dependency. Saved layouts continue to override producer defaults.

## 💥 Breaking changes

### Structured event protocol for extension widgets

Extension widgets now use structured snapshots over pi's in-process event bus, so producers can provide text, icon glyphs and colors, and layout defaults without depending on `pi-fancy-footer`.

The callback-based helpers have been removed. Producers should emit complete protocol-1 `upsert` messages on `pi-fancy-footer:widget`, republish when `pi-fancy-footer:ready` fires, and emit `remove` during shutdown:

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

Saved user settings continue to override the defaults carried by the event. Widget IDs use namespaced dot-separated segments such as `acme.status`, and an enabled widget with empty text remains hidden until its producer provides content.

*By @mavam and @codex in #20.*
