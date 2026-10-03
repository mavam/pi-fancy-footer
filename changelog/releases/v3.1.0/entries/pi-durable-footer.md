---
title: Pi Durable footer
type: feature
authors:
  - mavam
prs:
  - 41
created: 2026-10-03T08:33:06.034119Z
---

Pi Durable hosts can now mount the familiar footer with the
`pi-fancy-footer/durable` adapter:

```ts
import { createDurableFooter } from "pi-fancy-footer/durable";
const footer = createDurableFooter({
  view: () => conversationView.value,
  model: () => selectedModel,
  theme,
  exec,
  requestRender: () => tui.requestRender(),
});
```

The adapter uses the existing configuration, Git status, and quota display.
Conversation cost and cache totals include compacted history; context usage
stays unknown after reset or compaction until a successful response measures
it again. Hosts supply mounting and commands. Normal Pi support is unchanged.
