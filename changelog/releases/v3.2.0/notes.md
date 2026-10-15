Extension widgets can now color parts of their text with theme-colored spans, so producers like pi-agents can color status glyphs while counts keep the normal text color.

## 🚀 Features

### Colored text spans in extension widgets

Extension widgets can now color parts of their text. Add `content.spans`, a list of `{ text, color? }` runs, to a widget update and the footer renders each run in its theme color, for example to color agent status glyphs while counts keep the normal text color:

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

Spans without a color use the widget's text color, including your `textColor` override. Widgets that send plain `text` keep working unchanged.

*By @mavam.*
