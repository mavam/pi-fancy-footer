---
title: Colored text spans in extension widgets
type: feature
authors:
  - mavam
created: 2026-10-15T07:34:15.380371Z
---

Extension widgets can now color parts of their text. Add `content.spans`, a list
of `{ text, color? }` runs, to a widget update and the footer renders each run in
its theme color, for example to color agent status glyphs while counts keep the
normal text color:

```ts
content: {
  type: "text",
  text: "2◉ 1●",
  spans: [
    { text: "2" },
    { text: "◉", color: "warning" },
    { text: " 1" },
    { text: "●", color: "success" },
  ],
},
```

Spans without a color use the widget's text color, including your `textColor`
override. Widgets that send plain `text` keep working unchanged.
