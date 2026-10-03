Mount the familiar footer in a Pi Durable host with your existing configuration, Git status, and quota display. Conversation usage remains available after compaction.

## 🚀 Features

### Pi Durable footer

Pi Durable hosts can now mount the familiar footer with the `pi-fancy-footer/durable` adapter:

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

The adapter uses the existing configuration, Git status, and quota display. Conversation cost and cache totals include compacted history; context usage stays unknown after reset or compaction until a successful response measures it again. Hosts supply mounting and commands. Normal Pi support is unchanged.

*By @mavam in #41.*
