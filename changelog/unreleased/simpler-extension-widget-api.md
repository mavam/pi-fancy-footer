---
title: Simpler extension widget API
type: breaking
author: mavam
created: 2026-04-28T10:31:09.091608Z
---

The extension widget API now uses a smaller widget definition contract.

Before:

```ts
contributeFancyFooterWidgets(pi, {
  id: "acme.build-status",
  description: "Shows the latest CI result for the current branch.",
  defaults: {
    row: 1,
    position: 8,
    align: "right",
    fill: "none",
  },
  renderText: () => "passing",
});
```

After:

```ts
contributeFancyFooterWidgets(pi, {
  id: "acme.build-status",
  row: 1,
  order: 8,
  align: "right",
  render: () => "passing",
});
```

Update contributed widgets to replace `defaults.position` with `order`, remove `defaults`, and replace `renderText` with `render`.
