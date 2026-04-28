This release simplifies extension widget definitions with a smaller render-first API. It also adds an unresolved pull request review thread widget and refreshes the Nerd Font icon language for clearer footer status.

## 💥 Breaking changes

### Simpler extension widget API

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

*By @mavam.*

## 🚀 Features

### Unresolved PR review thread footer widget

The footer can now show unresolved GitHub review threads for the current pull request with the `pull-request-review-threads` widget.

For example, a branch with PR #7 and two unresolved review threads now renders both counts next to each other:

```text
📁mavam/pi-fancy-footer 🌿topic/pr-comments 🔖2ce2807 🔀7 💬2
```

*By @mavam and @codex in #7.*

## 🔧 Changes

### Clearer Nerd Font icon language

The built-in Nerd Font icon language is now more consistent across the footer.

| Widget                | Before | After |
| --------------------- | ------ | ----- |
| `model`               | `󰧑`    | `󰚩`   |
| `thinking`            | `󰭻`    | `󰧑`   |
| `git-status` diverged | ``    | ``   |
| `total-cost`          | `$`    | `󰇁`   |

The `model` widget now uses a robot symbol, while `thinking` uses a brain symbol instead of a comment bubble. This matches the emoji icon language and avoids using the brain metaphor for both concepts. The `total-cost` widget now uses a dedicated currency symbol. The Nerd Font git status symbols also use a vertical diverged marker, matching the direction of the ahead and behind markers. The README icon table now documents the actual Nerd Font symbols for all built-in widgets instead of leaving cells blank.

*By @mavam and @codex.*
